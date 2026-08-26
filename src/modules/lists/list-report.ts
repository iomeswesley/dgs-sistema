import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { buildCsv } from "@/lib/csv.js";
import { formatPhone } from "@/lib/phone.js";
import { REFUSAL_REASON_LABEL, STATUS_EXPLANATION, STATUS_LABEL, STATUS_ORDER } from "@/lib/labels.js";
import { toBrasiliaDateString } from "@/lib/timezone.js";

/*
  Relatório de uma lista pra devolver à secretaria — hoje em dois formatos
  (CSV e PDF, pedido do usuário em 2026-08-27, mesmo "tempero" do relatório
  de Cancelamento: agrupado por situação, com legenda e cabeçalho
  profissional). Os dois botões da Revisão ("Exportar CSV"/"Exportar PDF")
  partem da mesma consulta — `getListReportData()` normaliza os dados uma
  vez só, cada formato só decide como desenhar.
*/

export interface ListReportRow {
  patientName: string;
  phone: string | null;
  cns: string | null;
  procedureName: string;
  doctorName: string;
  scheduledAt: Date;
  status: string;
  refusalReasonLabel: string | null;
  note: string | null;
}

export interface ListReportData {
  listId: number;
  municipalityName: string;
  /** Nome do primeiro médico encontrado; " (e outros)" quando a lista mistura mais de um (raro, PDF malformado). */
  doctorName: string;
  unitName: string | null;
  /** "YYYY-MM-DD" quando dá pra resolver num dia só; range "DD/MM a DD/MM" quando os agendamentos caem em dias diferentes. */
  dateLabel: string;
  rows: ListReportRow[];
}

export async function getListReportData(listId: number): Promise<ListReportData> {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: {
      municipality: { select: { name: true } },
      agenda: { select: { date: true, unit: { select: { name: true } } } },
      createdAt: true,
    },
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

  const doctorNames = [...new Set(appointments.map((a) => a.doctor.name))];
  const doctorName = doctorNames.length === 0 ? "—" : doctorNames.length === 1 ? doctorNames[0]! : `${doctorNames[0]} (e outros)`;

  let dateLabel: string;
  if (list.agenda) {
    // `agenda.date` é `@db.Date` — lê os componentes UTC direto, nunca por
    // timeZone (ver comentário em `cancellations.service.ts`/CLAUDE.md).
    const d = list.agenda.date;
    dateLabel = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  } else if (appointments.length > 0) {
    const dates = appointments.map((a) => toBrasiliaDateString(a.scheduledAt)).sort();
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;
    dateLabel = first === last ? formatDdMm(first) : `${formatDdMm(first)} a ${formatDdMm(last)}`;
  } else {
    dateLabel = "—";
  }

  return {
    listId,
    municipalityName: list.municipality.name,
    doctorName,
    unitName: list.agenda?.unit?.name ?? null,
    dateLabel,
    rows: appointments.map((a) => ({
      patientName: a.patient.name,
      phone: a.selectedPhone,
      cns: a.patient.cns,
      procedureName: a.procedure.name,
      doctorName: a.doctor.name,
      scheduledAt: a.scheduledAt,
      status: a.status,
      refusalReasonLabel: a.refusalReason ? (REFUSAL_REASON_LABEL[a.refusalReason] ?? null) : null,
      note: a.refusalNote ?? a.contactNote ?? null,
    })),
  };
}

function formatDdMm(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export function formatDateTimeBrasilia(date: Date): string {
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

/** Agrupa as linhas por situação, na ordem "boas notícias primeiro" (`STATUS_ORDER`) — só os grupos que têm gente. */
export function groupByStatus(rows: ListReportRow[]): { status: string; rows: ListReportRow[] }[] {
  const byStatus = new Map<string, ListReportRow[]>();
  for (const row of rows) {
    const list = byStatus.get(row.status) ?? [];
    list.push(row);
    byStatus.set(row.status, list);
  }
  return STATUS_ORDER.map((status) => ({ status, rows: byStatus.get(status) ?? [] })).filter((g) => g.rows.length > 0);
}

/**
 * CSV pra abrir no Excel — bloco de metadados no topo (município, médico,
 * data, gerado em) e uma seção por situação, cada uma com seu próprio
 * cabeçalho de coluna. Pedido do usuário em 2026-08-27: antes era uma
 * tabela única, sem separação por situação nem contexto nenhum sobre de
 * qual lista/agenda o arquivo veio.
 */
export async function buildListReportCsv(listId: number): Promise<{ csv: string; filename: string; municipalityName: string }> {
  const data = await getListReportData(listId);

  const lines: (string | number | null)[][] = [
    ["DGS — D'Artibale Gestão em Saúde"],
    ["Relatório de Confirmações"],
    [],
    ["Município", data.municipalityName],
    ["Médico", data.doctorName],
    ...(data.unitName ? [["Unidade", data.unitName]] : []),
    ["Data da agenda", data.dateLabel],
    ["Total de pacientes", data.rows.length],
    ["Gerado em", formatDateTimeBrasilia(new Date())],
    [],
  ];

  for (const group of groupByStatus(data.rows)) {
    lines.push([`${STATUS_LABEL[group.status] ?? group.status} (${group.rows.length})`]);
    lines.push(["Paciente", "Telefone", "CNS", "Data/Hora", "Procedimento", "Médico", "Motivo", "Observação"]);
    for (const row of group.rows) {
      lines.push([
        row.patientName,
        row.phone ? formatPhone(row.phone) : "",
        row.cns ?? "",
        formatDateTimeBrasilia(row.scheduledAt),
        row.procedureName,
        row.doctorName,
        row.refusalReasonLabel ?? "",
        row.note ?? "",
      ]);
    }
    lines.push([]);
  }

  return {
    csv: buildCsv(lines),
    filename: `lista-${listId}.csv`,
    municipalityName: data.municipalityName,
  };
}
