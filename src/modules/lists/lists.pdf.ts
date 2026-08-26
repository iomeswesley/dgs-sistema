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
import { buildListReportFilename, formatDateTimeBrasilia, getListReportData, groupByStatus } from "./list-report.js";

/*
  PDF do relatório de confirmações de uma lista — mesmo "tempero" do PDF de
  Cancelamento (pedido do usuário em 2026-08-27): agrupado por situação
  (aqui, `Appointment.status` — confirmou/recusou/aguardando/problema —
  ordem "boas notícias primeiro" de `STATUS_ORDER`, ver `lib/labels.ts`),
  com legenda e cabeçalho profissional. O desenho em si mora em
  `@/lib/report-pdf.ts`, compartilhado com `cancellations.pdf.ts`.

  Sem coluna de motivo (pedido do usuário em 2026-08-27) — diferente do
  Cancelamento, aqui a maioria das situações não tem motivo nenhum (só
  "Recusou" tem), então a coluna ficava vazia quase sempre; quem quiser
  esse detalhe encontra no CSV, que continua com "Motivo"/"Observação".
*/

const COLS: ReportColumn[] = [
  { label: "Paciente", width: 0.3 },
  { label: "Telefone", width: 0.16 },
  { label: "Procedimento", width: 0.32 },
  { label: "Data/Hora", width: 0.22 },
];

export async function generateListReportPdf(listId: number): Promise<{ pdf: Buffer; filename: string }> {
  const data = await getListReportData(listId);
  const { doc, finished } = createReportDocument(`Relatório de Confirmações — ${data.municipalityName}`);

  // Sem "Lista #<id>" no cabeçalho nem no rodapé (pedido do usuário em
  // 2026-08-27) — o município/médico/data já identificam o documento, o
  // id interno não diz nada pra quem recebe de fora.
  drawBrandHeader(doc, "Relatório de Confirmações", `Gerado em ${formatDateTimeBrasilia(new Date())}`);

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
      ]),
    });
  }

  drawPageNumbers(
    doc,
    (page, total) => `DGS — D'Artibale Gestão em Saúde · Relatório de Confirmações · página ${page} de ${total}`
  );

  doc.end();
  const pdf = await finished;
  return { pdf, filename: buildListReportFilename(data, "pdf") };
}
