import { formatPhone } from "@/lib/phone.js";
import { STATUS_COLOR, STATUS_EXPLANATION, STATUS_LABEL } from "@/lib/labels.js";
import {
  createReportDocument,
  drawBrandHeader,
  drawLegend,
  drawMetaRows,
  drawPageNumbers,
  drawReportGroup,
  drawSeparator,
  type ReportColumn,
} from "@/lib/report-pdf.js";
import { formatDateTimeBrasilia, getListReportData, groupByStatus } from "./list-report.js";

/*
  PDF do relatório de confirmações de uma lista — mesmo "tempero" do PDF de
  Cancelamento (pedido do usuário em 2026-08-27): agrupado por situação
  (aqui, `Appointment.status` — confirmou/recusou/aguardando/problema —
  ordem "boas notícias primeiro" de `STATUS_ORDER`, ver `lib/labels.ts`),
  com legenda e cabeçalho profissional. O desenho em si mora em
  `@/lib/report-pdf.ts`, compartilhado com `cancellations.pdf.ts`.
*/

const COLS: ReportColumn[] = [
  { label: "Paciente", width: 0.3 },
  { label: "Telefone", width: 0.15 },
  { label: "Procedimento", width: 0.25 },
  { label: "Data/Hora", width: 0.2 },
  { label: "Motivo", width: 0.1 },
];

export async function generateListReportPdf(listId: number): Promise<Buffer> {
  const data = await getListReportData(listId);
  const { doc, finished } = createReportDocument(`Relatório de Confirmações — ${data.municipalityName}`);

  drawBrandHeader(
    doc,
    "Relatório de Confirmações",
    `Lista #${data.listId} · gerado em ${formatDateTimeBrasilia(new Date())}`
  );

  const rows: [string, string][] = [
    ["Médico", data.doctorName],
    ["Data da agenda", data.dateLabel],
    ["Município", data.municipalityName],
  ];
  if (data.unitName) rows.push(["Unidade", data.unitName]);
  rows.push(["Total de pacientes", String(data.rows.length)]);
  drawMetaRows(doc, rows);
  drawSeparator(doc);

  const groups = groupByStatus(data.rows);
  drawLegend(
    doc,
    "O que significa cada situação",
    groups.map((g) => ({
      label: STATUS_LABEL[g.status] ?? g.status,
      color: STATUS_COLOR[g.status]?.fg ?? "#6b7280",
      explanation: STATUS_EXPLANATION[g.status] ?? "",
    }))
  );

  for (const group of groups) {
    const color = STATUS_COLOR[group.status] ?? { fg: "#6b7280", bg: "#eef1f4" };
    drawReportGroup(doc, {
      label: STATUS_LABEL[group.status] ?? group.status,
      color: color.fg,
      bg: color.bg,
      columns: COLS,
      rows: group.rows.map((item) => [
        item.patientName,
        item.phone ? formatPhone(item.phone) : "—",
        item.procedureName,
        formatDateTimeBrasilia(item.scheduledAt),
        item.refusalReasonLabel ?? "—",
      ]),
    });
  }

  drawPageNumbers(
    doc,
    (page, total) => `DGS — D'Artibale Gestão em Saúde · Lista #${data.listId} · página ${page} de ${total}`
  );

  doc.end();
  return finished;
}
