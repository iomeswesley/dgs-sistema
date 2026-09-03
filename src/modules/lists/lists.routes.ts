import { Router } from "express";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth } from "@/middleware/auth.js";
import { parseBody, routeId } from "@/lib/http.js";
import { pickAlternatePhone } from "@/lib/phone.js";
import { classifyReply } from "@/lib/templates.js";
import {
  addManualAppointment,
  approveList,
  checkUnit,
  deleteList,
  editAppointment,
  extractAndStage,
  getMessagePreview,
  importAdditionalPatients,
  removeAppointment,
  retryFailedAppointments,
} from "./lists.service.js";
import { previewList } from "./lists.preview.js";
import { enqueueList, processQueue, queueCapacity } from "@/modules/queue/queue.service.js";
import { extractionConfigured } from "@/modules/extraction/extraction.service.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import {
  getCancellationStatusSummary,
  type CancellationStatusSummary,
} from "@/modules/cancellations/cancellations.service.js";

export const listsRouter = Router();
listsRouter.use("/api/lists", requireAuth);

/**
 * Roda depois da resposta HTTP já ter sido enviada. Em dev/servidor
 * tradicional isso já funcionava sozinho (o processo continua vivo), mas na
 * Vercel a função é congelada logo depois da resposta — sem `waitUntil`, a
 * extração ficava pausada no meio e só retomava (já com a transação do
 * Prisma expirada) quando uma requisição nova acordava a mesma instância,
 * às vezes dezenas de segundos depois. `waitUntil` é no-op fora da Vercel.
 */
function runInBackground(task: Promise<unknown>, onError: (err: unknown) => void): void {
  const guarded = task.catch(onError);
  waitUntil(guarded);
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Só PDF nativo (SISREG ou CELK) — a prefeitura não manda mais foto, e a
// extração é local (sem IA), que só lê texto de PDF de verdade.
const ACCEPTED_TYPES = ["application/pdf"];

const uploadSchema = z.object({
  municipalityId: z.number().int().positive(),
  agendaId: z.number().int().positive().nullish(),
  originalName: z.string().min(1),
  mimeType: z.string().min(1),
  /** Conteúdo do arquivo em base64. */
  fileBase64: z.string().min(1),
  isComplementary: z.boolean().optional(),
});

listsRouter.get(
  "/api/lists",
  asyncHandler(async (_req, res) => {
    const lists = await prisma.list.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        sourceFormat: true,
        status: true,
        isComplementary: true,
        extractionError: true,
        createdAt: true,
        approvedAt: true,
        dispatchedAt: true,
        municipality: { select: { id: true, name: true } },
        agenda: { select: { id: true, date: true, doctor: { select: { id: true, name: true } } } },
        uploadedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    });

    // Composição de cada lista pela faixa de status — mesmo formato que a
    // faixa de status usa no painel.
    const counts = await prisma.appointment.groupBy({
      by: ["listId", "status"],
      _count: { _all: true },
    });

    const byList = new Map<number, Record<string, number>>();
    for (const row of counts) {
      const entry = byList.get(row.listId) ?? {};
      entry[row.status] = row._count._all;
      byList.set(row.listId, entry);
    }

    // Agenda cancelada: TODOS os agendamentos da lista viraram "Cancelado"
    // — não olha `CancellationBatch.listId` (só cobre quem foi enviado
    // direto pra um cancelamento), porque uma lista normal, nunca ligada a
    // cancelamento nenhum na hora do upload, também vira assim quando a
    // AGENDA dela é cancelada depois pelo caminho "Agenda já cadastrada"
    // (que liga por `agendaId`, `CancellationBatch.listId` fica `null`
    // nesse caso — achado pelo usuário em 2026-08-27, com uma lista real
    // de produção nessa exata situação). Uma lista com só uma parte
    // cancelada (paciente cancelado avulso, não a agenda inteira) não
    // entra aqui de propósito — "Confirmados/Recusados" continua fazendo
    // sentido pro resto dela.
    const cancellationSummaries = new Map<number, CancellationStatusSummary>();
    for (const list of lists) {
      const listCounts = byList.get(list.id) ?? {};
      const total = Object.values(listCounts).reduce((sum, value) => sum + value, 0);
      const allCancelled = total > 0 && listCounts.CANCELADO === total;
      if (!allCancelled) continue;
      const summary = await getCancellationStatusSummary(list.id);
      if (summary) cancellationSummaries.set(list.id, summary);
    }

    res.json({
      lists: lists.map((list) => ({
        ...list,
        counts: byList.get(list.id) ?? {},
        usedInCancellation: cancellationSummaries.has(list.id),
        cancellationCounts: cancellationSummaries.get(list.id) ?? null,
      })),
      extractionConfigured,
    });
  })
);

const previewSchema = z.object({
  mimeType: z.string().min(1),
  fileBase64: z.string().min(1),
});

/**
 * Roda antes de a lista existir no banco — só lê o arquivo (rápido, local)
 * e sugere município/unidade/agenda pra pré-preencher o formulário de
 * upload. Não persiste nada; a equipe ainda confirma no envio de verdade.
 */
listsRouter.post(
  "/api/lists/preview",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, previewSchema);
    if (!ACCEPTED_TYPES.includes(data.mimeType)) {
      throw new AppError("Envie um PDF gerado pelo SISREG ou CELK.", 400);
    }
    const fileData = Buffer.from(data.fileBase64, "base64");
    if (fileData.length === 0) throw new AppError("Arquivo vazio.", 400);
    if (fileData.length > MAX_UPLOAD_BYTES) {
      throw new AppError("Arquivo maior que 20 MB. Divida em partes.", 413);
    }

    const preview = await previewList(fileData, data.mimeType);
    res.json({ preview });
  })
);

listsRouter.post(
  "/api/lists",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, uploadSchema);

    if (!ACCEPTED_TYPES.includes(data.mimeType)) {
      throw new AppError("Envie um PDF gerado pelo SISREG ou CELK.", 400);
    }

    const fileData = Buffer.from(data.fileBase64, "base64");
    if (fileData.length === 0) throw new AppError("Arquivo vazio.", 400);
    if (fileData.length > MAX_UPLOAD_BYTES) {
      throw new AppError("Arquivo maior que 20 MB. Divida em partes.", 413);
    }

    const list = await prisma.list.create({
      data: {
        clientId: requireActiveClientId(),
        municipalityId: data.municipalityId,
        agendaId: data.agendaId ?? null,
        originalName: data.originalName,
        mimeType: data.mimeType,
        fileData,
        sizeBytes: fileData.length,
        isComplementary: data.isComplementary ?? false,
        uploadedById: currentUserId(req),
        status: extractionConfigured ? "EXTRAINDO" : "EM_REVISAO",
      },
    });

    res.status(201).json({ list: { id: list.id, status: list.status } });

    // A extração roda depois da resposta: leitura de PDF leva dezenas de
    // segundos e o navegador não precisa esperar. O painel acompanha pelo
    // status da lista.
    if (extractionConfigured) {
      runInBackground(extractAndStage(list.id), (err) =>
        console.error(`[LISTA ${list.id}] Falha na extração:`, (err as Error).message)
      );
    }
  })
);

listsRouter.delete(
  "/api/lists/:id",
  asyncHandler(async (req, res) => {
    await deleteList(routeId(req), currentUserId(req));
    res.status(204).end();
  })
);

/** Arquivo original, pra revisão lado a lado. */
listsRouter.get(
  "/api/lists/:id/file",
  asyncHandler(async (req, res) => {
    const list = await prisma.list.findUnique({
      where: { id: routeId(req) },
      select: { fileData: true, mimeType: true, originalName: true },
    });
    if (!list) throw new AppError("Lista não encontrada", 404);

    res.setHeader("Content-Type", list.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(list.originalName)}"`);
    res.send(Buffer.from(list.fileData));
  })
);

/** Lista com os agendamentos, pra tela de revisão. */
listsRouter.get(
  "/api/lists/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const list = await prisma.list.findUnique({
      where: { id },
      select: {
        id: true,
        agendaId: true,
        originalName: true,
        mimeType: true,
        sourceFormat: true,
        status: true,
        extractionError: true,
        extractionRaw: true,
        createdAt: true,
        municipality: { select: { id: true, name: true } },
        agenda: { select: { id: true, date: true, unit: { select: { id: true, name: true, address: true } } } },
      },
    });
    if (!list) throw new AppError("Lista não encontrada", 404);

    const appointments = await prisma.appointment.findMany({
      where: { listId: id },
      orderBy: { id: "asc" },
      include: {
        patient: { select: { id: true, name: true, cns: true, phones: true, optedOut: true } },
        doctor: { select: { id: true, name: true } },
        procedure: { select: { id: true, name: true } },
        requestingUnit: { select: { id: true, name: true } },
      },
    });

    const warnings =
      list.extractionRaw && typeof list.extractionRaw === "object" && "warnings" in list.extractionRaw
        ? ((list.extractionRaw as { warnings?: string[] }).warnings ?? [])
        : [];
    const executingUnit =
      list.extractionRaw && typeof list.extractionRaw === "object" && "executingUnit" in list.extractionRaw
        ? ((list.extractionRaw as { executingUnit?: string | null }).executingUnit ?? null)
        : null;
    // Palpite melhor-esforço por registro que a leitura não conseguiu
    // reconhecer de jeito nenhum — pré-preenche "Adicionar paciente
    // manualmente" em vez de a equipe começar do zero (pedido do usuário
    // em 2026-08-26).
    const unrecognized =
      list.extractionRaw && typeof list.extractionRaw === "object" && "unrecognized" in list.extractionRaw
        ? ((list.extractionRaw as { unrecognized?: unknown[] }).unrecognized ?? [])
        : [];
    // Recalcula contra o cadastro atual (não o que ficou congelado na
    // extração) — se alguém corrigiu o endereço da unidade depois, a
    // revisão já reflete isso sem precisar reprocessar a lista.
    const unitCheck = await checkUnit(list.agendaId, executingUnit);

    // Outro celular do cadastro, diferente do que já foi tentado — sugestão
    // pronta pro "Reenviar pra quem falhou" (mesma dinâmica do Cancelamento).
    const appointmentsWithAlternate = appointments.map((a) => ({
      ...a,
      alternatePhone: pickAlternatePhone(a.patient.phones, a.selectedPhone),
    }));

    // "Respondido, mas não deu pra entender o quê" — pedido do usuário em
    // 2026-09-03: até aqui, quem escrevia algo que não era Sim/Não claro
    // ficava indistinguível de quem nunca respondeu nada (os dois só
    // apareciam como ENVIADO/ENTREGUE). Separado aqui: agendamento ainda
    // "aberto" (nunca chegou a CONFIRMADO/RECUSADO) com pelo menos 1
    // mensagem recebida cuja intenção o classificador não conseguiu
    // resolver como confirmação/recusa/opt-out — mesma função
    // (`classifyReply`) que o webhook usa de verdade, então bate certinho
    // com o que realmente ficou sem aplicar.
    const OPEN_STATUSES = new Set(["ENVIADO", "ENTREGUE", "FALHA", "SEM_RESPOSTA"]);
    const openIds = appointments.filter((a) => OPEN_STATUSES.has(a.status)).map((a) => a.id);
    const inboundByAppointment = new Map<number, { body: string | null; buttonPayload: string | null }[]>();
    if (openIds.length > 0) {
      const inbound = await prisma.whatsappMessage.findMany({
        where: { appointmentId: { in: openIds }, direction: "RECEBIDA" },
        orderBy: { createdAt: "asc" },
        select: { appointmentId: true, body: true, buttonPayload: true },
      });
      for (const m of inbound) {
        if (m.appointmentId === null) continue;
        const list = inboundByAppointment.get(m.appointmentId) ?? [];
        list.push({ body: m.body, buttonPayload: m.buttonPayload });
        inboundByAppointment.set(m.appointmentId, list);
      }
    }
    const appointmentsWithReplyFlag = appointmentsWithAlternate.map((a) => {
      const inbound = inboundByAppointment.get(a.id) ?? [];
      // O agendamento só entrou em `openIds` (acima) porque NUNCA virou
      // CONFIRMADO/RECUSADO — então qualquer resposta ligada a ele aqui, seja
      // texto ambíguo ("unknown") ou até um "Sim"/"Não" classificável que
      // chegou tarde demais (depois do fim do dia da consulta, ver
      // `endOfBrasiliaDay` em whatsapp.service.ts), é prova de que a resposta
      // existe mas não aplicou sozinha — precisa de alguém olhar e decidir.
      // Só `opt_out` fica de fora (tratado à parte, não é confirmação/recusa).
      const unresolved = inbound.filter((m) => {
        const intent = classifyReply({ buttonPayload: m.buttonPayload, text: m.body });
        return intent !== "opt_out";
      });
      const last = unresolved[unresolved.length - 1];
      return {
        ...a,
        hasUnclassifiedReply: unresolved.length > 0,
        lastReplyPreview: last ? (last.buttonPayload ?? last.body) : null,
      };
    });

    res.json({
      list: { ...list, extractionRaw: undefined },
      appointments: appointmentsWithReplyFlag,
      warnings,
      unrecognized,
      unitCheck,
    });
  })
);

const editSchema = z.object({
  patientName: z.string().min(1).optional(),
  selectedPhone: z.string().nullish(),
  scheduledAt: z.string().datetime({ offset: true }).or(z.string().min(16)).optional(),
  doctorId: z.number().int().positive().optional(),
  procedureId: z.number().int().positive().optional(),
  isFirstVisit: z.boolean().nullish(),
});

listsRouter.patch(
  "/api/lists/appointments/:id",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, editSchema);
    await editAppointment(routeId(req), data, currentUserId(req));
    res.json({ ok: true });
  })
);

listsRouter.delete(
  "/api/lists/appointments/:id",
  asyncHandler(async (req, res) => {
    await removeAppointment(routeId(req), currentUserId(req));
    res.status(204).end();
  })
);

const manualAppointmentSchema = z.object({
  patientName: z.string().trim().min(1, "Nome obrigatório"),
  cns: z.string().trim().nullish(),
  phone: z.string().trim().min(1, "Telefone obrigatório"),
  scheduledAt: z.string().min(16),
  doctorId: z.number().int().positive(),
  procedureId: z.number().int().positive(),
  isFirstVisit: z.boolean().nullish(),
  sourceRawText: z.string().nullish(),
});

/**
 * Adiciona um paciente à mão — pra "Registro não reconhecido". Funciona em
 * qualquer status da lista; se já passou da revisão, a mensagem sai na
 * hora (mesma convenção do dispatch normal — enfileira e já processa, o
 * resto o frontend completa sozinho com runQueueUntilDone).
 */
listsRouter.post(
  "/api/lists/:id/appointments",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, manualAppointmentSchema);
    const result = await addManualAppointment(routeId(req), data, currentUserId(req));
    if (result.queued) await processQueue();
    res.status(201).json(result);
  })
);

const importAdditionalSchema = z.object({
  mimeType: z.string().min(1),
  fileBase64: z.string().min(1),
});

/**
 * Importa mais pacientes de um PDF novo pra dentro desta lista já
 * existente — pedido do usuário em 2026-08-27, ver `importAdditionalPatients()`.
 * Quem já está nesta lista (o PDF "atualizado" da prefeitura costuma trazer
 * todo mundo de novo, não só os novos) é ignorado, nunca duplicado.
 */
listsRouter.post(
  "/api/lists/:id/import-additional",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, importAdditionalSchema);
    if (!ACCEPTED_TYPES.includes(data.mimeType)) {
      throw new AppError("Só PDF nativo (SISREG ou CELK) é aceito.", 400);
    }
    const fileData = Buffer.from(data.fileBase64, "base64");
    if (fileData.byteLength > MAX_UPLOAD_BYTES) {
      throw new AppError("Arquivo maior que 20 MB. Divida em partes.", 400);
    }

    const result = await importAdditionalPatients(routeId(req), fileData, data.mimeType, currentUserId(req));
    if (result.queued > 0) await processQueue();
    res.status(201).json(result);
  })
);

listsRouter.post(
  "/api/lists/:id/reprocess",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const list = await prisma.list.findUnique({ where: { id } });
    if (!list) throw new AppError("Lista não encontrada", 404);
    if (list.status !== "EM_REVISAO" && list.status !== "ERRO") {
      throw new AppError("Só dá pra reprocessar lista em revisão ou com erro.", 409);
    }

    await prisma.list.update({ where: { id }, data: { status: "EXTRAINDO", extractionError: null } });
    res.json({ ok: true });
    runInBackground(extractAndStage(id), (err) =>
      console.error(`[LISTA ${id}] Falha no reprocessamento:`, (err as Error).message)
    );
  })
);

/**
 * Prévia da mensagem de verdade (já com as variáveis preenchidas) do
 * primeiro paciente da lista — pra conferir antes de aprovar, ver
 * `getMessagePreview()`.
 */
listsRouter.get(
  "/api/lists/:id/message-preview",
  asyncHandler(async (req, res) => {
    res.json(await getMessagePreview(routeId(req)));
  })
);

const approveSchema = z.object({ confirmUnitMismatch: z.boolean().optional() });

listsRouter.post(
  "/api/lists/:id/approve",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, approveSchema);
    await approveList(routeId(req), currentUserId(req), data.confirmUnitMismatch ?? false);
    res.json({ ok: true });
  })
);

listsRouter.post(
  "/api/lists/:id/dispatch",
  asyncHandler(async (req, res) => {
    const result = await enqueueList(routeId(req), currentUserId(req));
    // Dispara na hora, sem esperar alguém ir em Acompanhamento clicar em
    // "Rodar cadência do dia" — esse fica só pra monitorar e pra reenvio/
    // lembrete, não pro disparo inicial.
    const processed = await processQueue();
    const capacity = await queueCapacity();
    res.json({ ...result, ...processed, capacity });
  })
);

const retryFailedSchema = z.object({
  updates: z
    .array(
      z.object({
        appointmentId: z.number().int().positive(),
        phone: z.string().trim().min(1, "Telefone vazio"),
      })
    )
    .min(1, "Nenhum telefone informado"),
});

/** Reenvia a confirmação (ou convite de vaga aberta) pra quem falhou, com telefone novo. */
listsRouter.post(
  "/api/lists/:id/retry-failed",
  asyncHandler(async (req, res) => {
    const { updates } = parseBody(req, retryFailedSchema);
    const result = await retryFailedAppointments(routeId(req), updates, currentUserId(req));
    // Mesma convenção do dispatch: enfileira e já processa na hora — o
    // resto, se não couber, o frontend completa sozinho (runQueueUntilDone).
    await processQueue();
    res.status(201).json(result);
  })
);

/**
 * Encerra a lista. O relatório de confirmações continua disponível pra
 * download manual ("Exportar", na Revisão) — o envio automático por
 * e-mail à secretaria foi removido de propósito (fora de escopo).
 */
listsRouter.post(
  "/api/lists/:id/conclude",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const list = await prisma.list.findUnique({ where: { id } });
    if (!list) throw new AppError("Lista não encontrada", 404);
    if (list.status !== "DISPARADA") {
      throw new AppError("Só uma lista já disparada pode ser concluída.", 409);
    }

    await prisma.list.update({ where: { id }, data: { status: "CONCLUIDA" } });
    await recordAudit({ userId: currentUserId(req), action: "conclude", entity: "List", entityId: id });

    res.json({ ok: true });
  })
);
