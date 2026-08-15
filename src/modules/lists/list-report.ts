import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { toCsv } from "@/lib/csv.js";
import { formatPhone } from "@/lib/phone.js";
import { REFUSAL_REASON_LABEL, STATUS_LABEL } from "@/lib/labels.js";

/**
 * Relatório de uma lista para devolver à secretaria: nome, telefone (via
 * status) e o que cada paciente respondeu, com o motivo quando recusou.
 * Só download manual (botão "Exportar" na Revisão) — não há mais envio
 * automático por e-mail.
 */
export async function buildListReportCsv(listId: number): Promise<{ csv: string; filename: string; municipalityName: string }> {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { municipality: { select: { name: true } }, createdAt: true },
  });
  if (!list) throw new AppError("Lista não encontrada", 404);

  const appointments = await prisma.appointment.findMany({
    where: { listId },
    orderBy: { scheduledAt: "asc" },
    include: {
      patient: { select: { name: true, cns: true } },
      doctor: { select: { name: true } },
      procedure: { select: { name: true } },
    },
  });

  const csv = toCsv(
    ["Paciente", "Telefone", "CNS", "Data/Hora", "Procedimento", "Médico", "Situação", "Motivo", "Observação"],
    appointments.map((appointment) => [
      appointment.patient.name,
      appointment.selectedPhone ? formatPhone(appointment.selectedPhone) : "",
      appointment.patient.cns ?? "",
      appointment.scheduledAt.toLocaleString("pt-BR"),
      appointment.procedure.name,
      appointment.doctor.name,
      STATUS_LABEL[appointment.status] ?? appointment.status,
      appointment.refusalReason ? (REFUSAL_REASON_LABEL[appointment.refusalReason] ?? "") : "",
      appointment.refusalNote ?? appointment.contactNote ?? "",
    ])
  );

  return {
    csv,
    filename: `lista-${listId}.csv`,
    municipalityName: list.municipality.name,
  };
}
