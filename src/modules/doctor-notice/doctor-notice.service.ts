import { prisma } from "@/lib/prisma.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";
import { AppError } from "@/middleware/errorHandler.js";
import { sendTemplate, WhatsappSendError } from "@/lib/whatsapp.js";
import { TEMPLATE_NAMES } from "@/lib/templates.js";
import { renderTemplateText } from "@/lib/whatsapp-templates.js";
import { queueCapacity } from "@/modules/queue/queue.service.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { doctorGreetingName, formatAgendaDate, isMorningWindow, summarizeProcedures, tomorrowCalendarDate } from "./doctor-notice.js";

/*
  Aviso da agenda ao MÉDICO na véspera (pedido do cliente, 2026-11-14).

  Um dia antes de cada agenda, de manhã, o médico recebe no WhatsApp a data,
  o procedimento e o local. O total de pacientes saiu da mensagem (decisão do
  usuário), mas agenda sem nenhum paciente (ou toda cancelada) continua sem
  aviso automático — não lembra o médico de agenda que não vai ter. Não passa
  pela fila de pacientes (MessageJob é sempre de um agendamento): são poucas
  mensagens por dia, enviadas direto e registradas em WhatsappMessage sem
  appointmentId — aparecem em Conversas, e a resposta do médico também.

  Quem chama: o cron (`/api/cron/queue`, que o GitHub Actions dispara a cada
  10 min) e o botão "Avisar médico" em Configurações → Agendas.
*/

const NOTICE_INCLUDE = {
  doctor: true,
  municipality: true,
  unit: true,
  procedure: true,
} as const;

type NoticeAgenda = NonNullable<Awaited<ReturnType<typeof loadAgenda>>>;

function loadAgenda(id: number) {
  return prisma.agenda.findUnique({ where: { id }, include: NOTICE_INCLUDE });
}

/** Agendamentos que contam pra agenda: os ligados a ela ou às listas dela, menos os cancelados. */
function agendaAppointmentsWhere(agendaId: number) {
  return {
    status: { not: "CANCELADO" as const },
    OR: [{ agendaId }, { list: { agendaId } }],
  };
}

async function describeProcedure(agenda: NoticeAgenda): Promise<string> {
  if (agenda.procedure) return agenda.procedure.name;
  const rows = await prisma.appointment.findMany({
    where: agendaAppointmentsWhere(agenda.id),
    select: { procedure: { select: { name: true } } },
    distinct: ["procedureId"],
  });
  return summarizeProcedures(rows.map((r) => r.procedure.name));
}

export async function buildNoticeParams(agenda: NoticeAgenda) {
  const local = agenda.unit
    ? [agenda.unit.name, agenda.unit.address].filter(Boolean).join(" - ")
    : agenda.municipality.name;
  return {
    header: [agenda.municipality.name],
    body: [
      doctorGreetingName(agenda.doctor),
      formatAgendaDate(agenda.date),
      await describeProcedure(agenda),
      local,
    ],
  };
}

export type NoticeOutcome = "sent" | "failed" | "skipped";

/**
 * Manda o aviso de UMA agenda. Não lança por falha de envio (devolve
 * "failed" e grava o motivo na agenda) — o cron segue pras outras.
 */
async function sendNotice(agenda: NoticeAgenda, { allowEmpty }: { allowEmpty: boolean }): Promise<{ outcome: NoticeOutcome; reason?: string }> {
  const skip = async (reason: string) => {
    await prisma.agenda.update({ where: { id: agenda.id }, data: { doctorNoticeError: reason } });
    return { outcome: "skipped" as const, reason };
  };

  if (!agenda.doctor.phone) return skip("Médico sem celular no cadastro.");

  const patientCount = await prisma.appointment.count({ where: agendaAppointmentsWhere(agenda.id) });
  if (patientCount === 0 && !allowEmpty) return skip("Agenda ainda sem pacientes — aviso não enviado.");

  const capacity = await queueCapacity();
  if (capacity.billing.blocked) return skip("Envio bloqueado pelo limite de mensagens do cliente.");
  if (capacity.remaining <= 0) return skip("Teto diário de mensagens do WhatsApp atingido.");

  const params = await buildNoticeParams(agenda);
  const templateName = TEMPLATE_NAMES.AVISO_MEDICO;
  const body = renderTemplateText(templateName, params.header, params.body);
  const clientId = requireActiveClientId();
  const phone = agenda.doctor.phone;

  try {
    const result = await sendTemplate(phone, templateName, params);
    await prisma.$transaction([
      prisma.whatsappMessage.create({
        data: {
          clientId,
          wamid: result.wamid,
          direction: "ENVIADA",
          template: "AVISO_MEDICO",
          phone,
          body,
          status: "ENVIADO",
          sentAt: new Date(),
        },
      }),
      prisma.agenda.update({
        where: { id: agenda.id },
        data: { doctorNoticeSentAt: new Date(), doctorNoticeFailedAt: null, doctorNoticeError: null },
      }),
    ]);
    return { outcome: "sent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha desconhecida";
    const code = err instanceof WhatsappSendError ? err.code : undefined;
    await prisma.$transaction([
      prisma.whatsappMessage.create({
        data: {
          clientId,
          direction: "ENVIADA",
          template: "AVISO_MEDICO",
          phone,
          body,
          status: "FALHOU",
          errorCode: code ?? null,
          errorMessage: message,
          failedAt: new Date(),
        },
      }),
      prisma.agenda.update({
        where: { id: agenda.id },
        data: { doctorNoticeFailedAt: new Date(), doctorNoticeError: `Falha no envio: ${message}` },
      }),
    ]);
    return { outcome: "failed", reason: message };
  }
}

export interface DoctorNoticeResult {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Aviso automático: agendas de AMANHÃ, só na janela da manhã (o cron roda o
 * dia todo). Cada agenda sai uma vez só — enviada ou recusada pela Meta não
 * repete; "sem pacientes" tenta de novo na próxima rodada da manhã (a lista
 * pode subir mais tarde).
 */
export async function notifyDoctorsForTomorrow(now = new Date()): Promise<DoctorNoticeResult> {
  const result: DoctorNoticeResult = { sent: 0, failed: 0, skipped: 0 };
  if (!isMorningWindow(now)) return result;

  const agendas = await prisma.agenda.findMany({
    where: {
      date: tomorrowCalendarDate(now),
      doctorNoticeSentAt: null,
      doctorNoticeFailedAt: null,
      doctor: { active: true, notifyAgenda: true, phone: { not: null } },
    },
    include: NOTICE_INCLUDE,
    orderBy: { id: "asc" },
  });

  for (const agenda of agendas) {
    const { outcome } = await sendNotice(agenda, { allowEmpty: false });
    result[outcome]++;
  }
  return result;
}

/**
 * Botão "Avisar médico" (Configurações → Agendas): manda agora, mesmo que
 * já tenha saído antes (reenvio) e mesmo sem pacientes — quem clicou decidiu.
 */
export async function notifyDoctorNow(agendaId: number, userId: number | null) {
  const agenda = await loadAgenda(agendaId);
  if (!agenda) throw new AppError("Agenda não encontrada", 404);
  if (!agenda.doctor.phone) {
    throw new AppError(`${agenda.doctor.name} não tem celular no cadastro. Preencha em Configurações → Médicos.`, 409);
  }

  const { outcome, reason } = await sendNotice(agenda, { allowEmpty: true });
  await recordAudit({
    userId,
    action: "doctor_notice",
    entity: "Agenda",
    entityId: agendaId,
    newValue: outcome,
    metadata: reason ? { reason } : undefined,
  });
  if (outcome === "failed") throw new AppError(`A Meta recusou o envio: ${reason}`, 502);
  if (outcome === "skipped") throw new AppError(reason ?? "Aviso não enviado.", 409);
}
