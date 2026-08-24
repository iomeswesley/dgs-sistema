import type { AppointmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { processQueue } from "@/modules/queue/queue.service.js";
import { toBrasiliaDateString } from "@/lib/timezone.js";
import { phoneCandidates } from "@/lib/phone.js";

/*
  Cancelamento de agenda inteira — o médico não vai poder atender (cirurgia,
  licença etc.), e todo mundo já agendado precisa saber. Duas origens
  possíveis:

  - Agenda já cadastrada (caminho normal) — município/unidade/médico/data
    vêm dela, sem precisar selecionar de novo.
  - List enviada na hora, sem agenda vinculada (2026-08-25) — pro caso da
    agenda nunca ter passado pela plataforma. Reaproveita o mesmo upload +
    extração de Listas (`POST /api/lists` sem `agendaId`), só que em vez de
    seguir pro fluxo normal (Revisão → Aprovar → Disparar com CONFIRMACAO),
    a equipe cancela direto os agendamentos extraídos.

  Status vira CANCELADO na hora do disparo (decisão da equipe), não depende
  do envio ter sucesso — ver comentário em queue.service.ts.
*/

export type CancellationSource = { agendaId: number } | { listId: number };

// Quem NÃO recebe o aviso: já recusou antes (não faz sentido reavisar quem
// já disse que não ia), já foi cancelado (idempotência — não duplica se
// alguém tentar cancelar a mesma agenda/lista duas vezes) ou não tem
// telefone. Opt-out (LGPD) é filtrado à parte, pelo paciente, não pelo status.
const EXCLUDED_STATUSES: AppointmentStatus[] = ["RECUSADO", "CANCELADO", "SEM_TELEFONE"];

function sourceWhere(source: CancellationSource) {
  return "agendaId" in source ? { agendaId: source.agendaId } : { listId: source.listId };
}

async function eligibleAppointments(source: CancellationSource) {
  return prisma.appointment.findMany({
    where: {
      ...sourceWhere(source),
      status: { notIn: EXCLUDED_STATUSES },
      selectedPhone: { not: null },
      patient: { optedOut: false },
    },
    orderBy: { scheduledAt: "asc" },
    include: { patient: true, procedure: true },
  });
}

export interface CancellablePatient {
  appointmentId: number;
  patientName: string;
  scheduledAt: Date;
  procedureName: string;
  status: string;
}

export interface CancellationSourceInfo {
  /** "YYYY-MM-DD" — já resolvido pro dia certo, o frontend só formata pra exibir. */
  date: string;
  doctorName: string;
  municipalityName: string;
  unitName: string | null;
}

/**
 * `agenda.date` (`@db.Date`) já é meia-noite UTC do dia certo — lê os
 * componentes UTC direto, nunca `toLocaleDateString` com `timeZone`
 * (isso subtrairia 3h e cairia no dia anterior, achado em 2026-08-26).
 */
function agendaDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

export interface CancellationPreview {
  source: CancellationSourceInfo;
  patients: CancellablePatient[];
}

/**
 * Info descritiva da origem, pra mostrar no topo da revisão — vem direto da
 * Agenda quando existe; quando é uma List sem agenda, é reconstruída a
 * partir do primeiro agendamento extraído (data/médico) + o município da
 * própria List. Se a lista tiver mais de um médico misturado (raro, PDF
 * malformado), só o primeiro aparece aqui — não afeta quem recebe o aviso.
 */
async function describeSource(source: CancellationSource): Promise<CancellationSourceInfo> {
  if ("agendaId" in source) {
    const agenda = await prisma.agenda.findUnique({
      where: { id: source.agendaId },
      include: { doctor: true, municipality: true, unit: true },
    });
    if (!agenda) throw new AppError("Agenda não encontrada.", 404);
    return {
      date: agendaDateString(agenda.date),
      doctorName: agenda.doctor.name,
      municipalityName: agenda.municipality.name,
      unitName: agenda.unit?.name ?? null,
    };
  }

  const list = await prisma.list.findUnique({ where: { id: source.listId }, include: { municipality: true } });
  if (!list) throw new AppError("Lista não encontrada.", 404);
  const firstAppointment = await prisma.appointment.findFirst({
    where: { listId: source.listId },
    orderBy: { scheduledAt: "asc" },
    include: { doctor: true },
  });
  return {
    // scheduledAt é timestamp de verdade (não @db.Date) — aqui sim
    // converte pro fuso de Brasília, é o dia local que interessa.
    date: toBrasiliaDateString(firstAppointment?.scheduledAt ?? list.createdAt),
    doctorName: firstAppointment?.doctor.name ?? "—",
    municipalityName: list.municipality.name,
    unitName: null,
  };
}

export async function previewCancellation(source: CancellationSource): Promise<CancellationPreview> {
  const [info, appointments] = await Promise.all([describeSource(source), eligibleAppointments(source)]);

  return {
    source: info,
    patients: appointments.map((a) => ({
      appointmentId: a.id,
      patientName: a.patient.name,
      scheduledAt: a.scheduledAt,
      procedureName: a.procedure.name,
      status: a.status,
    })),
  };
}

export async function dispatchCancellation(
  source: CancellationSource,
  reason: string,
  userId: number
): Promise<{ batchId: number; queued: number }> {
  // Reconsulta no servidor em vez de confiar na lista que o preview mandou
  // pro cliente — evita cancelar quem respondeu (confirmou/recusou) entre
  // o preview e o clique em "Disparar".
  const appointments = await eligibleAppointments(source);
  if (appointments.length === 0) {
    throw new AppError("Nenhum paciente elegível pra notificar nessa agenda.", 400);
  }

  const batch = await prisma.cancellationBatch.create({
    data: {
      reason,
      createdById: userId,
      agendaId: "agendaId" in source ? source.agendaId : null,
      listId: "listId" in source ? source.listId : null,
    },
  });

  const now = new Date();
  for (const appointment of appointments) {
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "CANCELADO", cancellationBatchId: batch.id, canceledById: userId, canceledAt: now },
    });
    await prisma.messageJob.create({
      data: { appointmentId: appointment.id, template: "CANCELAMENTO", phone: appointment.selectedPhone! },
    });
  }

  await recordAudit({
    userId,
    action: "cancel",
    entity: "CancellationBatch",
    entityId: batch.id,
    metadata: { ...source, reason, queued: appointments.length },
  });

  // Mesma convenção do disparo de lista: enfileira e já processa na hora,
  // em vez de esperar o próximo cron.
  await processQueue();

  return { batchId: batch.id, queued: appointments.length };
}

export interface CancellationBatchSummary {
  id: number;
  source: CancellationSourceInfo;
  reason: string;
  createdAt: Date;
  createdByName: string;
  count: number;
}

async function summarize(batch: {
  id: number;
  agendaId: number | null;
  listId: number | null;
  reason: string;
  createdAt: Date;
  createdBy: { name: string };
  _count: { appointments: number };
}): Promise<CancellationBatchSummary> {
  const source: CancellationSource = batch.agendaId ? { agendaId: batch.agendaId } : { listId: batch.listId! };
  return {
    id: batch.id,
    source: await describeSource(source),
    reason: batch.reason,
    createdAt: batch.createdAt,
    createdByName: batch.createdBy.name,
    count: batch._count.appointments,
  };
}

export async function listCancellationBatches(): Promise<CancellationBatchSummary[]> {
  const batches = await prisma.cancellationBatch.findMany({
    orderBy: { createdAt: "desc" },
    include: { createdBy: true, _count: { select: { appointments: true } } },
  });
  return Promise.all(batches.map(summarize));
}

export interface CancellationBatchDetail extends CancellationBatchSummary {
  appointments: {
    id: number;
    patientName: string;
    phone: string | null;
    procedureName: string;
    scheduledAt: Date;
    messageStatus: string | null;
    /** Se o paciente respondeu QUALQUER coisa depois (não só o botão do template). */
    replied: boolean;
    replyPreview: string | null;
  }[];
}

export async function getCancellationBatch(id: number): Promise<CancellationBatchDetail> {
  const batch = await prisma.cancellationBatch.findUnique({
    where: { id },
    include: {
      createdBy: true,
      appointments: {
        include: {
          patient: true,
          procedure: true,
          messages: { where: { template: "CANCELAMENTO" }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!batch) throw new AppError("Cancelamento não encontrado.", 404);

  const summary = await summarize({ ...batch, _count: { appointments: batch.appointments.length } });

  // Resposta do paciente é QUALQUER mensagem recebida depois do aviso, não
  // só o botão pronto do template ("Ciente, obrigado(a)") — pedido do
  // usuário em 2026-08-26, pra saber quem já ficou ciente de verdade, texto
  // livre incluído. Casada por telefone (mesmo `phoneCandidates` de
  // Conversas — o formato bruto salvo varia entre envio e recebimento).
  const phones = batch.appointments.map((a) => a.selectedPhone).filter((p): p is string => !!p);
  const candidateSet = [...new Set(phones.flatMap((p) => phoneCandidates(p)))];
  const replies =
    candidateSet.length > 0
      ? await prisma.whatsappMessage.findMany({
          where: { direction: "RECEBIDA", phone: { in: candidateSet } },
          orderBy: { createdAt: "desc" },
          select: { phone: true, body: true, buttonPayload: true },
        })
      : [];
  const replyByPhone = new Map<string, { body: string | null; buttonPayload: string | null }>();
  for (const reply of replies) {
    if (!replyByPhone.has(reply.phone)) replyByPhone.set(reply.phone, reply);
  }
  function findReply(phone: string | null) {
    if (!phone) return null;
    for (const candidate of phoneCandidates(phone)) {
      const hit = replyByPhone.get(candidate);
      if (hit) return hit;
    }
    return null;
  }

  return {
    ...summary,
    appointments: batch.appointments.map((a) => {
      const reply = findReply(a.selectedPhone);
      return {
        id: a.id,
        patientName: a.patient.name,
        phone: a.selectedPhone,
        procedureName: a.procedure.name,
        scheduledAt: a.scheduledAt,
        messageStatus: a.messages[0]?.status ?? null,
        replied: !!reply,
        replyPreview: reply?.body ?? reply?.buttonPayload ?? null,
      };
    }),
  };
}
