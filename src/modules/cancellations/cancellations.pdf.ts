import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { formatPhone } from "@/lib/phone.js";
import type { CancellationBatchDetail } from "./cancellations.service.js";

/*
  PDF de um cancelamento pra devolver à secretaria — pedido do usuário em
  2026-08-27: "algo bem profissional que posteriormente possa ser enviado
  pra secretaria da saúde". Agrupado em blocos por situação da mensagem
  (Lido, Entregue, Enviado, Falhou, Sem envio), mesma classificação e mesma
  regra de "resposta conta como Lido" já usada na tela (`CancelamentoDetalhe.tsx`
  — mantidas em sincronia manualmente, são poucas linhas dos dois lados).

  pdfkit é puro JS (sem binário nativo, sem canvas) — mesma categoria de
  cuidado que já mordeu o projeto com `pdfjs-dist` na extração (ver
  CLAUDE.md, "Extração de PDF na Vercel"), mas aqui os fonts padrão são
  `require()`ados por caminho literal (`#standard-fonts/...`, subpath import
  do próprio pacote), não carregados dinamicamente — não é a mesma classe de
  risco, mas vale testar contra produção depois do primeiro deploy.
*/

const PAGE_MARGIN = 48;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;

const INK = "#1f2430";
const MUTED = "#6b7280";
const RULE = "#e2e4e9";
// Azul-marinho da marca (pedido do usuário em 2026-08-27, mesma cor do
// menu lateral no modo escuro — ver --board em index.css) — antes era um
// cinza quase preto.
const HEADER_BG = "#042951";
const ROW_ALT_BG = "#f7f7f8";

/**
 * Logo oficial (fundo branco, letras em azul-marinho) — vive num chip
 * branco no cabeçalho, porque o fundo dele não é transparente e o
 * cabeçalho agora é escuro. Resolve tanto em produção (`dist-web/`, gerado
 * pelo build do Vite, já incluso em `includeFiles` no vercel.json) quanto
 * em dev local (`web/public/`, antes do build existir). `null` se nenhum
 * dos dois existir — nesse caso o cabeçalho cai pra um texto "DGS" simples,
 * nunca quebra a geração do PDF por causa de um arquivo faltando.
 */
function resolveLogoPath(): string | null {
  const candidates = [
    path.join(process.cwd(), "dist-web", "dgs-logo.png"),
    path.join(process.cwd(), "web", "public", "dgs-logo.png"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

interface StatusGroup {
  key: string;
  label: string;
  color: string;
  bg: string;
  explanation: string;
}

// Mesma ordem "do resolvido pro pendente" que a legenda da tela usa —
// quem só quer confirmar que deu tudo certo lê a primeira seção e já sabe.
const STATUS_GROUPS: StatusGroup[] = [
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

// Larguras das colunas da tabela de pacientes, em % da largura útil.
const COLS = [
  { label: "Paciente", width: 0.33 },
  { label: "Telefone", width: 0.16 },
  { label: "Procedimento", width: 0.27 },
  { label: "Horário original", width: 0.24 },
] as const;

export async function generateCancellationPdf(detail: CancellationBatchDetail): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true, info: { Title: `Cancelamento — ${detail.source.doctorName}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  drawHeader(doc, detail);
  drawLegend(doc);

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
    drawStatusSection(doc, group, items);
  }

  drawPageNumbers(doc, detail);

  doc.end();
  return finished;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const bottom = doc.page.height - PAGE_MARGIN;
  if (doc.y + needed > bottom) doc.addPage();
}

function drawHeader(doc: PDFKit.PDFDocument, detail: CancellationBatchDetail): void {
  // Faixa azul-marinho no topo (mesma cor do menu lateral no modo escuro).
  doc.rect(0, 0, doc.page.width, 84).fill(HEADER_BG);

  // Logo oficial num chip branco — o arquivo já tem "D'ARTIBALE GESTÃO EM
  // SAÚDE" desenhado dentro dele, não precisa de tagline separada do lado.
  const logoPath = resolveLogoPath();
  if (logoPath) {
    const chipW = 78;
    const chipH = 46;
    const chipX = PAGE_MARGIN;
    const chipY = (84 - chipH) / 2;
    doc.roundedRect(chipX, chipY, chipW, chipH, 4).fill("#ffffff");
    doc.image(logoPath, chipX + 8, chipY + 7, { fit: [chipW - 16, chipH - 14], align: "center", valign: "center" });
  } else {
    // Nunca deveria faltar (o arquivo vai junto do deploy), mas se faltar
    // não trava a geração do PDF — cai num texto simples.
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text("DGS", PAGE_MARGIN, 30);
  }

  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13).text("Cancelamento de Agenda", PAGE_MARGIN, 22, {
    width: CONTENT_WIDTH,
    align: "right",
  });
  doc
    .fillColor("#c7c9cf")
    .font("Helvetica")
    .fontSize(9)
    .text(`Lote #${detail.id} · gerado em ${formatDateTime(new Date())}`, PAGE_MARGIN, 40, {
      width: CONTENT_WIDTH,
      align: "right",
    });

  doc.y = 84 + 20;
  doc.x = PAGE_MARGIN;

  // Bloco de metadados — médico, data, município/unidade, motivo.
  const rows: [string, string][] = [
    ["Médico", detail.source.doctorName],
    ["Data da agenda", formatCalendarDate(detail.source.date)],
    ["Município", detail.source.municipalityName],
  ];
  if (detail.source.unitName) rows.push(["Unidade", detail.source.unitName]);
  rows.push(["Disparado em", `${formatDateTime(detail.createdAt)} por ${detail.createdByName}`]);

  const labelWidth = 120;
  for (const [label, value] of rows) {
    doc
      .fillColor(MUTED)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(label.toUpperCase(), PAGE_MARGIN, doc.y, { width: labelWidth, continued: false });
    doc
      .fillColor(INK)
      .font("Helvetica")
      .fontSize(10)
      .text(value, PAGE_MARGIN + labelWidth, doc.y - 12, { width: CONTENT_WIDTH - labelWidth });
    doc.moveDown(0.15);
  }

  doc.moveDown(0.3);
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(9).text("MOTIVO INFORMADO", PAGE_MARGIN, doc.y);
  doc.fillColor(INK).font("Helvetica").fontSize(10).text(detail.reason, PAGE_MARGIN, doc.y + 2, { width: CONTENT_WIDTH });

  doc.moveDown(0.8);
  ruleLine(doc);
  doc.moveDown(0.6);
}

function ruleLine(doc: PDFKit.PDFDocument): void {
  doc
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y)
    .lineWidth(0.75)
    .strokeColor(RULE)
    .stroke();
}

function drawLegend(doc: PDFKit.PDFDocument): void {
  ensureSpace(doc, 130);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text("O que significa cada situação da mensagem", PAGE_MARGIN, doc.y);
  doc.moveDown(0.4);

  const colWidth = CONTENT_WIDTH / 2;
  let startY = doc.y;
  let col = 0;
  let maxRowY = startY;

  for (const group of STATUS_GROUPS) {
    const x = PAGE_MARGIN + col * colWidth;
    const y = startY;
    doc.circle(x + 4, y + 5, 4).fill(group.color);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5).text(group.label, x + 14, y, { continued: false });
    const textHeight = doc
      .font("Helvetica")
      .fontSize(8)
      .heightOfString(group.explanation, { width: colWidth - 20 });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(group.explanation, x + 14, y + 11, { width: colWidth - 20 });

    maxRowY = Math.max(maxRowY, y + 11 + textHeight);
    col++;
    if (col === 2) {
      col = 0;
      startY = maxRowY + 8;
    }
  }

  doc.y = maxRowY + 12;
  doc.x = PAGE_MARGIN;
  ruleLine(doc);
  doc.moveDown(0.6);
}

function drawTableHeader(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  let x = PAGE_MARGIN;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED);
  for (const col of COLS) {
    const width = CONTENT_WIDTH * col.width;
    doc.text(col.label.toUpperCase(), x + 2, y, { width: width - 4 });
    x += width;
  }
  doc.y = y + 14;
  doc.x = PAGE_MARGIN;
  ruleLine(doc);
  doc.moveDown(0.35);
}

function drawStatusSection(
  doc: PDFKit.PDFDocument,
  group: StatusGroup,
  items: CancellationBatchDetail["appointments"]
): void {
  ensureSpace(doc, 60);

  // Barra colorida com o nome da situação + contagem — mesma paleta da
  // legenda acima, pra bater o vínculo visual entre elas.
  const barHeight = 22;
  doc.rect(PAGE_MARGIN, doc.y, CONTENT_WIDTH, barHeight).fill(group.bg);
  doc.rect(PAGE_MARGIN, doc.y, 3, barHeight).fill(group.color);
  doc
    .fillColor(group.color)
    .font("Helvetica-Bold")
    .fontSize(10.5)
    .text(`${group.label}  ·  ${items.length} paciente${items.length === 1 ? "" : "s"}`, PAGE_MARGIN + 12, doc.y + 6, {
      width: CONTENT_WIDTH - 20,
    });
  doc.y += barHeight + 8;
  doc.x = PAGE_MARGIN;

  drawTableHeader(doc);

  const rowHeight = 18;
  items.forEach((item, index) => {
    if (doc.y + rowHeight > doc.page.height - PAGE_MARGIN) {
      doc.addPage();
      doc.y = PAGE_MARGIN;
      doc.x = PAGE_MARGIN;
      // Continuação: repete a barra da situação (mais fina) pra quem olhar
      // uma página no meio não perder de vista qual bloco é esse.
      doc.rect(PAGE_MARGIN, doc.y, CONTENT_WIDTH, 16).fill(group.bg);
      doc
        .fillColor(group.color)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(`${group.label} (continuação)`, PAGE_MARGIN + 8, doc.y + 4);
      doc.y += 16 + 8;
      doc.x = PAGE_MARGIN;
      drawTableHeader(doc);
    }

    const y = doc.y;
    if (index % 2 === 1) doc.rect(PAGE_MARGIN, y - 2, CONTENT_WIDTH, rowHeight).fill(ROW_ALT_BG);

    let x = PAGE_MARGIN;
    const values = [
      item.patientName,
      item.phone ? formatPhone(item.phone) : "—",
      item.procedureName,
      formatDateTime(item.scheduledAt),
    ];
    doc.font("Helvetica").fontSize(9).fillColor(INK);
    values.forEach((value, i) => {
      const width = CONTENT_WIDTH * COLS[i]!.width;
      doc.text(value, x + 2, y, { width: width - 4, height: rowHeight, ellipsis: true });
      x += width;
    });
    doc.y = y + rowHeight;
    doc.x = PAGE_MARGIN;
  });

  doc.moveDown(0.7);
}

/**
 * Rodapé com numeração — desenhado por último, depois de todo o conteúdo,
 * revisitando cada página já criada (`switchToPage`).
 *
 * Bug corrigido em 2026-08-27: escrever perto do fim físico da página
 * (`page.height - 30`) fica DENTRO da margem inferior do documento
 * (`PAGE_MARGIN = 48`) — o pdfkit acha que o texto está estourando a área
 * de conteúdo e insere uma página nova sozinho pra "continuar" o texto,
 * mesmo sem sobrar linha nenhuma pra continuar. Como isso acontecia pra
 * cada uma das páginas já existentes, o PDF de um cancelamento de 4
 * páginas saía com 4 páginas em branco extras no final. Zerar a margem
 * inferior só durante esse desenho evita o gatilho, sem afetar o layout
 * do resto do conteúdo (já desenhado antes disso).
 */
function drawPageNumbers(doc: PDFKit.PDFDocument, detail: CancellationBatchDetail): void {
  const range = doc.bufferedPageRange();
  const originalBottomMargin = doc.page.margins.bottom;
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(
        `DGS — D'Artibale Gestão em Saúde · Cancelamento #${detail.id} · página ${i + 1} de ${range.count}`,
        PAGE_MARGIN,
        doc.page.height - 30,
        { width: CONTENT_WIDTH, align: "center", lineBreak: false }
      );
    doc.page.margins.bottom = originalBottomMargin;
  }
}
