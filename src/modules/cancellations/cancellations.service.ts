import type { AppointmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { processQueue } from "@/modules/queue/queue.service.js";

/*
  Cancelamento de agenda inteira — o médico não vai poder atender (cirurgia,
  licença etc.), e todo mundo já agendado precisa saber. Diferente de Listas:
  não tem upload nenhum, parte de uma Agenda já cadastrada — município,
  unidade, médico e data já vêm dela, não precisa selecionar de novo.

  Status vira CANCELADO na hora do disparo (decisão da equipe), não depende
  do envio ter sucesso — ver comentário em queue.service.ts.
*/

// Quem NÃO recebe o aviso: já recusou antes (não faz sentido reavisar quem
// já disse que não ia), já foi cancelado (idempotência — não duplica se
// alguém tentar cancelar a mesma agenda duas vezes) ou não tem telefone.
// Opt-out (LGPD) é filtrado à parte, pelo paciente, não pelo status.
const EXCLUDED_STATUSES: AppointmentStatus[] = ["RECUSADO", "CANCELADO", "SEM_TELEFONE"];

export interface CancellablePatient {
  appointmentId: number;
  patientName: string;
  scheduledAt: Date;
  procedureName: string;
  status: string;
}

export interface CancellationPreview {
  agenda: {
    id: number;
    date: Date;
    doctorName: string;
    municipalityName: string;
    unitName: string | null;
  };
  patients: CancellablePatient[];
}

async function eligibleAppointments(agendaId: number) {
  return prisma.appointment.findMany({
    where: {
      agendaId,
      status: { notIn: EXCLUDED_STATUSES },
      selectedPhone: { not: null },
      patient: { optedOut: false },
    },
    orderBy: { scheduledAt: "asc" },
    include: { patient: true, procedure: true },
  });
}

export async function previewCancellation(agendaId: number): Promise<CancellationPreview> {
  const agenda = await prisma.agenda.findUnique({
    where: { id: agendaId },
    include: { doctor: true, municipality: true, unit: true },
  });
  if (!agenda) throw new AppError("Agenda não encontrada.", 404);

  const appointments = await eligibleAppointments(agendaId);

  return {
    agenda: {
      id: agenda.id,
      date: agenda.date,
      doctorName: agenda.doctor.name,
      municipalityName: agenda.municipality.name,
      unitName: agenda.unit?.name ?? null,
    },
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
  agendaId: number,
  reason: string,
  userId: number
): Promise<{ batchId: number; queued: number }> {
  // Reconsulta no servidor em vez de confiar na lista que o preview mandou
  // pro cliente — evita cancelar quem respondeu (confirmou/recusou) entre
  // o preview e o clique em "Disparar".
  const appointments = await eligibleAppointments(agendaId);
  if (appointments.length === 0) {
    throw new AppError("Nenhum paciente elegível pra notificar nessa agenda.", 400);
  }

  const batch = await prisma.cancellationBatch.create({ data: { agendaId, reason, createdById: userId } });

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
    metadata: { agendaId, reason, queued: appointments.length },
  });

  // Mesma convenção do disparo de lista: enfileira e já processa na hora,
  // em vez de esperar o próximo cron.
  await processQueue();

  return { batchId: batch.id, queued: appointments.length };
}

export interface CancellationBatchSummary {
  id: number;
  agendaId: number;
  reason: string;
  createdAt: Date;
  createdByName: string;
  agendaDate: Date;
  doctorName: string;
  municipalityName: string;
  count: number;
}

export async function listCancellationBatches(): Promise<CancellationBatchSummary[]> {
  const batches = await prisma.cancellationBatch.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      agenda: { include: { doctor: true, municipality: true } },
      createdBy: true,
      _count: { select: { appointments: true } },
    },
  });
  return batches.map((b) => ({
    id: b.id,
    agendaId: b.agendaId,
    reason: b.reason,
    createdAt: b.createdAt,
    createdByName: b.createdBy.name,
    agendaDate: b.agenda.date,
    doctorName: b.agenda.doctor.name,
    municipalityName: b.agenda.municipality.name,
    count: b._count.appointments,
  }));
}

export interface CancellationBatchDetail extends CancellationBatchSummary {
  appointments: {
    id: number;
    patientName: string;
    procedureName: string;
    scheduledAt: Date;
    messageStatus: string | null;
  }[];
}

export async function getCancellationBatch(id: number): Promise<CancellationBatchDetail> {
  const batch = await prisma.cancellationBatch.findUnique({
    where: { id },
    include: {
      agenda: { include: { doctor: true, municipality: true } },
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

  return {
    id: batch.id,
    agendaId: batch.agendaId,
    reason: batch.reason,
    createdAt: batch.createdAt,
    createdByName: batch.createdBy.name,
    agendaDate: batch.agenda.date,
    doctorName: batch.agenda.doctor.name,
    municipalityName: batch.agenda.municipality.name,
    count: batch.appointments.length,
    appointments: batch.appointments.map((a) => ({
      id: a.id,
      patientName: a.patient.name,
      procedureName: a.procedure.name,
      scheduledAt: a.scheduledAt,
      messageStatus: a.messages[0]?.status ?? null,
    })),
  };
}
