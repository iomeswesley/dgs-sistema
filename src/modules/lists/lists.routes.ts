import { Router } from "express";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth } from "@/middleware/auth.js";
import { parseBody, routeId } from "@/lib/http.js";
import { pickAlternatePhone } from "@/lib/phone.js";
import {
  approveList,
  checkUnit,
  deleteList,
  editAppointment,
  extractAndStage,
  removeAppointment,
  retryFailedAppointments,
} from "./lists.service.js";
import { previewList } from "./lists.preview.js";
import { enqueueList, processQueue, queueCapacity } from "@/modules/queue/queue.service.js";
import { extractionConfigured } from "@/modules/extraction/extraction.service.js";
import { recordAudit } from "@/modules/audit/audit.service.js";

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
        agenda: { select: { id: true, date: true } },
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

    res.json({
      lists: lists.map((list) => ({ ...list, counts: byList.get(list.id) ?? {} })),
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

    res.json({
      list: { ...list, extractionRaw: undefined },
      appointments: appointmentsWithAlternate,
      warnings,
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
