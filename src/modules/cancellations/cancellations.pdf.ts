import { formatPhone } from "@/lib/phone.js";
import {
  createReportDocument,
  drawBrandHeader,
  drawLabeledText,
  drawLegend,
  drawMetaRows,
  drawPageNumbers,
  drawReportGroup,
  drawSeparator,
  type ReportColumn,
} from "@/lib/report-pdf.js";
import type { CancellationBatchDetail } from "./cancellations.service.js";

/*
  PDF de um cancelamento pra devolver à secretaria — pedido do usuário em
  2026-08-27: "algo bem profissional que posteriormente possa ser enviado
  pra secretaria da saúde". Agrupado em blocos por situação da mensagem
  (Lido, Entregue, Enviado, Falhou, Sem envio), mesma classificação e mesma
  regra de "resposta conta como Lido" já usada na tela (`CancelamentoDetalhe.tsx`
  — mantidas em sincronia manualmente, são poucas linhas dos dois lados).

  O desenho em si (cabeçalho, legenda, seções, rodapé) mora em
  `@/lib/report-pdf.ts`, compartilhado com `lists.pdf.ts` — "mesmo tempero,
  mesmo layout" (pedido do usuário).
*/

interface StatusGroupDef {
  key: string;
  label: string;
  color: string;
  bg: string;
  explanation: string;
}

// Mesma ordem "do resolvido pro pendente" que a legenda da tela usa —
// quem só quer confirmar que deu tudo certo lê a primeira seção e já sabe.
const STATUS_GROUPS: StatusGroupDef[] = [
  {
    key: "LIDO",
    label: "Lido",
    color: "#15803d",
    bg: "#e7f4ec",
    explanation:
      'O paciente abriu a conversa (recibo de leitura) ou já respondeu — as duas contam como "Lido" aqui, porque responder já prova que viu, mesmo com o recibo de leitura desativado.',
  },
  {
    key: "ENTREGUE",
    label: "Entregue",
    color: "#b45309",
    bg: "#fdf1e2",
    explanation: "Chegou no celular do paciente, ainda sem confirmação de leitura nem resposta.",
  },
  {
    key: "ENVIADO",
    label: "Enviado",
    color: "#b45309",
    bg: "#fdf1e2",
    explanation: "Saiu do número da DGS, ainda sem confirmação de chegada.",
  },
  {
    key: "FALHOU",
    label: "Falhou",
    color: "#b91c1c",
    bg: "#fbe9e9",
    explanation:
      "Não chegou — na prática, quase sempre número sem WhatsApp, inválido ou inalcançável (a operadora não distingue qual dos três).",
  },
  {
    key: "SEM_ENVIO",
    label: "Sem envio",
    color: "#4b5563",
    bg: "#eef0f2",
    explanation: "Sem telefone cadastrado pra esse paciente — não foi possível notificar do cancelamento.",
  },
];

const COLS: ReportColumn[] = [
  { label: "Paciente", width: 0.33 },
  { label: "Telefone", width: 0.16 },
  { label: "Procedimento", width: 0.27 },
  { label: "Horário original", width: 0.24 },
];

/** Mesma regra de `effectiveMessageStatus()` em `CancelamentoDetalhe.tsx`. */
function effectiveStatus(a: { messageStatus: string | null; replied: boolean }): string {
  if (a.replied && (a.messageStatus === "ENTREGUE" || a.messageStatus === "ENVIADO")) return "LIDO";
  return a.messageStatus ?? "SEM_ENVIO";
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export async function generateCancellationPdf(detail: CancellationBatchDetail): Promise<Buffer> {
  const { doc, finished } = createReportDocument(`Cancelamento — ${detail.source.doctorName}`);

  drawBrandHeader(doc, "Cancelamento de Agenda", `Lote #${detail.id} · gerado em ${formatDateTime(new Date())}`);

  const rows: [string, string][] = [
    ["Médico", detail.source.doctorName],
    ["Data da agenda", formatCalendarDate(detail.source.date)],
    ["Município", detail.source.municipalityName],
  ];
  if (detail.source.unitName) rows.push(["Unidade", detail.source.unitName]);
  // Só a data/hora, sem "por Fulano" — quem disparou é informação interna
  // da equipe, não faz sentido num documento que sai pra secretaria
  // (pedido do usuário em 2026-08-27).
  rows.push(["Disparado em", formatDateTime(detail.createdAt)]);
  drawMetaRows(doc, rows);

  drawLabeledText(doc, "Motivo informado", detail.reason);
  drawSeparator(doc);

  drawLegend(
    doc,
    "O que significa cada situação da mensagem",
    STATUS_GROUPS.map((g) => ({ label: g.label, color: g.color, explanation: g.explanation }))
  );

  const grouped = new Map<string, CancellationBatchDetail["appointments"]>();
  for (const appointment of detail.appointments) {
    const key = effectiveStatus(appointment);
    const list = grouped.get(key) ?? [];
    list.push(appointment);
    grouped.set(key, list);
  }

  for (const group of STATUS_GROUPS) {
    const items = grouped.get(group.key);
    if (!items || items.length === 0) continue;
    drawReportGroup(doc, {
      label: group.label,
      color: group.color,
      bg: group.bg,
      columns: COLS,
      rows: items.map((item) => [
        item.patientName,
        item.phone ? formatPhone(item.phone) : "—",
        item.procedureName,
        formatDateTime(item.scheduledAt),
      ]),
    });
  }

  drawPageNumbers(
    doc,
    (page, total) => `DGS — D'Artibale Gestão em Saúde · Cancelamento #${detail.id} · página ${page} de ${total}`
  );

  doc.end();
  return finished;
}
