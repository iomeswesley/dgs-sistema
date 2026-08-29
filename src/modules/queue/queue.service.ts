import type { TemplateKind } from "@prisma/client";
import { env } from "@/config/env.js";
import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { sendTemplate, WhatsappSendError } from "@/lib/whatsapp.js";
import { TEMPLATE_NAMES } from "@/lib/templates.js";
import { renderTemplateText } from "@/lib/whatsapp-templates.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { getPhoneNumberStatus } from "@/modules/whatsapp/whatsapp-account.service.js";

/*
  Fila de envio.

  Existe por causa do limite diário da Meta: um número novo começa em ~250
  conversas por 24h. Disparar 800 pacientes de uma vez não falha só nos 550
  excedentes — derruba a qualidade do número e pode restringir a conta.

  A fila respeita o teto do dia e REPORTA o que não coube, em vez de falhar em
  silêncio. O que sobra fica pendente e sai no dia seguinte.
*/

/** Intervalo entre envios, pra não disparar em rajada. */
const SEND_INTERVAL_MS = 250;

// Teto de quantos jobs buscar por chamada — quem garante não estourar o
// tempo da função é o TIME_BUDGET_MS abaixo (que já pára o loop sozinho
// bem antes disso ser um problema); esse número aqui é só um limite de
// memória/consulta razoável, não precisa ser preciso.
const BATCH_SIZE = 60;

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Quantas mensagens já saíram hoje — base do controle de limite. */
export async function sentToday(): Promise<number> {
  return prisma.whatsappMessage.count({
    where: { direction: "ENVIADA", createdAt: { gte: startOfToday() } },
  });
}

export interface QueueCapacity {
  dailyLimit: number;
  used: number;
  remaining: number;
  pending: number;
}

export async function queueCapacity(): Promise<QueueCapacity> {
  const [used, pending, status] = await Promise.all([
    sentToday(),
    prisma.messageJob.count({ where: { status: "PENDENTE" } }),
    getPhoneNumberStatus(),
  ]);
  // O tier já reflete o limite real do número (a Meta sobe sozinha conforme
  // o histórico) — o .env só serve de fallback, sandbox ou falha na consulta.
  const dailyLimit = status?.dailyLimit ?? env.WHATSAPP_DAILY_LIMIT;
  return {
    dailyLimit,
    used,
    remaining: Math.max(0, dailyLimit - used),
    pending,
  };
}

/**
 * Enfileira a confirmação de uma lista aprovada.
 *
 * Não envia nada aqui — só cria os jobs. O envio real acontece no
 * processamento da fila, que é quem respeita o limite.
 */
export async function enqueueList(listId: number, userId: number): Promise<{ queued: number; skipped: number }> {
  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) throw new AppError("Lista não encontrada", 404);
  if (list.status !== "APROVADA") {
    throw new AppError("Só lista aprovada pode ser disparada.", 409);
  }

  const appointments = await prisma.appointment.findMany({
    where: { listId, status: "PENDENTE", selectedPhone: { not: null } },
    include: { patient: { select: { optedOut: true } } },
  });

  // Lista complementar convida para uma vaga que abriu (template diferente,
  // com pergunta de interesse) — não é a mesma confirmação da lista original.
  const template: TemplateKind = list.isComplementary ? "VAGA_ABERTA" : "CONFIRMACAO";

  let queued = 0;
  let skipped = 0;

  for (const appointment of appointments) {
    // Opt-out é absoluto: quem pediu pra não receber não entra na fila,
    // nem que a secretaria mande o nome de novo.
    if (appointment.patient.optedOut) {
      skipped++;
      continue;
    }
    // Nunca dois jobs pro mesmo agendamento e template.
    const existing = await prisma.messageJob.findFirst({
      where: { appointmentId: appointment.id, template, status: { in: ["PENDENTE", "ENVIADO"] } },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.messageJob.create({
      data: {
        appointmentId: appointment.id,
        template,
        phone: appointment.selectedPhone!,
      },
    });
    queued++;
  }

  await prisma.list.update({
    where: { id: listId },
    data: { status: "DISPARADA", dispatchedAt: new Date() },
  });
  await recordAudit({
    userId,
    action: "dispatch",
    entity: "List",
    entityId: listId,
    metadata: { queued, skipped },
  });

  return { queued, skipped };
}

export interface ProcessResult {
  sent: number;
  failed: number;
  /** Jobs que não couberam no limite de hoje (só volta amanhã). */
  deferred: number;
  remainingToday: number;
  /**
   * Pendentes que já estão no horário de sair AGORA (não confundir com
   * `deferred`, que soma também lembrete/reenvio agendado pro futuro).
   * Achado em 2026-08-26: um disparo de 109 mensagens foi morto pelo
   * `maxDuration` de 60s da Vercel no meio do processamento — a equipe só
   * descobriu porque foi conferir no banco. `dueNow > 0` é o sinal pro
   * chamador (frontend) saber que precisa chamar `processQueue` nesta
   * função de novo JÁ, em vez de confiar que o cron de amanhã resolve.
   */
  dueNow: number;
}

// maxDuration é 60s (vercel.json) — pára de propósito antes disso pra nunca
// arriscar ser morto no meio de um job (o que deixava o MessageJob preso em
// "ENVIANDO" pra sempre, sem nenhuma mensagem de verdade ter saído — achado
// em 2026-08-26). O resto que não coube nessa chamada fica PENDENTE, pronto
// pra próxima — que o frontend já dispara sozinho, ver runQueueUntilDone()
// no lado do cliente.
const TIME_BUDGET_MS = 45_000;

/**
 * Processa a fila respeitando o teto diário.
 *
 * Chamado pelo cron do Vercel e pelo botão "processar agora" no painel — e,
 * quando sobra `dueNow`, automaticamente de novo pelo frontend até esvaziar
 * (nunca fica esperando o cron do dia seguinte pra terminar um disparo de
 * hoje).
 */
export async function processQueue(): Promise<ProcessResult> {
  const capacity = await queueCapacity();
  if (capacity.remaining === 0) {
    return { sent: 0, failed: 0, deferred: capacity.pending, remainingToday: 0, dueNow: 0 };
  }

  const jobs = await prisma.messageJob.findMany({
    where: { status: "PENDENTE", scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
    take: Math.min(BATCH_SIZE, capacity.remaining),
    include: {
      appointment: {
        include: {
          patient: true,
          municipality: true,
          procedure: true,
          doctor: true,
          agenda: { include: { unit: true } },
          cancellationBatch: true,
        },
      },
    },
  });

  let sent = 0;
  let failed = 0;
  const start = Date.now();

  for (const job of jobs) {
    if (Date.now() - start > TIME_BUDGET_MS) break;

    await prisma.messageJob.update({
      where: { id: job.id },
      data: { status: "ENVIANDO", attempts: { increment: 1 } },
    });

    // Cancelamento já é um fato decidido pela equipe no momento do disparo
    // (ver dispatchCancellation em modules/cancellations) — o
    // appointment.status já virou CANCELADO ali, independente do envio da
    // mensagem funcionar. Aqui só registra a mensagem em si, sem mexer no
    // status: sucesso ou falha de entrega não desfaz o cancelamento.
    const isCancellation = job.template === "CANCELAMENTO";
    const params = buildTemplateParams(job.template, job.appointment);

    try {
      const result = await sendTemplate(job.phone, TEMPLATE_NAMES[job.template], params);

      await prisma.$transaction([
        prisma.messageJob.update({
          where: { id: job.id },
          data: { status: "ENVIADO", processedAt: new Date(), lastError: null },
        }),
        prisma.whatsappMessage.create({
          data: {
            appointmentId: job.appointmentId,
            wamid: result.wamid,
            direction: "ENVIADA",
            template: job.template,
            phone: job.phone,
            body: renderTemplateText(TEMPLATE_NAMES[job.template], params.header, params.body),
            status: "ENVIADO",
            sentAt: new Date(),
          },
        }),
        ...(isCancellation
          ? []
          : [prisma.appointment.update({ where: { id: job.appointmentId }, data: { status: "ENVIADO" } })]),
      ]);
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha desconhecida";
      const code = err instanceof WhatsappSendError ? err.code : undefined;

      await prisma.$transaction([
        prisma.messageJob.update({
          where: { id: job.id },
          data: { status: "FALHA", processedAt: new Date(), lastError: message },
        }),
        prisma.whatsappMessage.create({
          data: {
            appointmentId: job.appointmentId,
            direction: "ENVIADA",
            template: job.template,
            phone: job.phone,
            body: renderTemplateText(TEMPLATE_NAMES[job.template], params.header, params.body),
            status: "FALHOU",
            errorCode: code ?? null,
            errorMessage: message,
            failedAt: new Date(),
          },
        }),
        ...(isCancellation
          ? []
          : [prisma.appointment.update({ where: { id: job.appointmentId }, data: { status: "FALHA" } })]),
      ]);
      failed++;
    }

    if (SEND_INTERVAL_MS > 0) await new Promise((resolve) => setTimeout(resolve, SEND_INTERVAL_MS));
  }

  const after = await queueCapacity();
  const dueNow = await prisma.messageJob.count({
    where: { status: "PENDENTE", scheduledFor: { lte: new Date() } },
  });
  return { sent, failed, deferred: after.pending, remainingToday: after.remaining, dueNow };
}

export type JobAppointment = Awaited<ReturnType<typeof prisma.appointment.findFirstOrThrow>> & {
  patient: { name: string };
  municipality: { name: string };
  procedure: { name: string; preparationInstructions: string | null };
  agenda: { unit: { name: string; address: string | null } | null } | null;
  cancellationBatch: { reason: string } | null;
};

// timeZone explícito é obrigatório aqui — vira texto de WhatsApp que o
// paciente lê. Não depender do fuso do processo (ver comentário em
// lib/timezone.ts: já mostrou não ser confiável em produção).
function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

/**
 * Monta as variáveis do template na ordem exata cadastrada na Meta.
 *
 * Variável vazia é rejeitada pela API, então tudo tem fallback — é
 * justamente o erro que hoje faz sair "Data: XX/07/2026" no WhatsApp comum.
 */
/** Exportado pra `lists.service.ts` montar a prévia da mensagem antes de aprovar — mesma lógica exata usada no envio real. */
export function buildTemplateParams(template: TemplateKind, appointment: JobAppointment) {
  const firstName = appointment.patient.name.trim().split(/\s+/)[0] ?? appointment.patient.name;
  const unit = appointment.agenda?.unit;
  const local = unit
    ? [unit.name, unit.address].filter(Boolean).join(" - ")
    : appointment.municipality.name;

  const date = formatDate(appointment.scheduledAt);
  const time = formatTime(appointment.scheduledAt);

  if (template === "LEMBRETE") {
    // O template embrulha a variável em "Preparo: {{6}}. Qualquer dúvida,
    // procure a unidade de saúde." — a Meta rejeita variável na última
    // posição do texto, só palavra ou pontuação sozinha depois não basta,
    // precisou de texto de verdade. Tira o ponto final daqui pra não duplicar.
    const preparation = (
      appointment.procedure.preparationInstructions?.trim() || "Nenhum preparo especial necessário"
    ).replace(/\.+$/, "");

    return {
      body: [firstName, date, time, appointment.procedure.name, local, preparation],
    };
  }

  if (template === "VAGA_ABERTA") {
    return {
      body: [firstName, appointment.municipality.name, appointment.procedure.name, date, time, local],
    };
  }

  if (template === "CANCELAMENTO") {
    // Texto do template não usa o primeiro nome (decisão do usuário,
    // 2026-08-22) — só procedimento, data e motivo, na ordem cadastrada.
    return {
      body: [appointment.procedure.name.toUpperCase(), date, appointment.cancellationBatch?.reason ?? ""],
    };
  }

  return {
    header: [appointment.municipality.name],
    body: [firstName, appointment.municipality.name, date, time, appointment.procedure.name, local],
  };
}
