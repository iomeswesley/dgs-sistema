import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

/*
  Motor comum dos relatórios em PDF pra devolver à secretaria — usado por
  `cancellations.pdf.ts` e `lists.pdf.ts` (pedido do usuário em 2026-08-27:
  "mesmo tempero, mesmo layout" nos dois). Cabeçalho azul-marinho com o logo
  num chip branco, bloco de metadados, legenda por situação, seções
  agrupadas com paginação, rodapé numerado — tudo genérico aqui, cada
  chamador só entra com o texto e as cores da própria classificação.

  pdfkit é puro JS (sem binário nativo, sem canvas) — mesma categoria de
  cuidado que já mordeu o projeto com `pdfjs-dist` na extração (ver
  CLAUDE.md, "Extração de PDF na Vercel"), mas aqui os fonts padrão são
  `require()`ados por caminho literal (`#standard-fonts/...`, subpath import
  do próprio pacote), não carregados dinamicamente — não é a mesma classe de
  risco, mas vale testar contra produção depois do primeiro deploy.
*/

export const PAGE_MARGIN = 48;
export const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;

export const INK = "#1f2430";
export const MUTED = "#6b7280";
export const RULE = "#e2e4e9";
// Azul-marinho da marca (pedido do usuário em 2026-08-27, mesma cor do
// menu lateral no modo escuro — ver --board em index.css).
export const HEADER_BG = "#042951";
export const ROW_ALT_BG = "#f7f7f8";

/**
 * Logo oficial (fundo branco, letras em azul-marinho) — vive num chip
 * branco no cabeçalho, porque o fundo dele não é transparente e o
 * cabeçalho é escuro. Resolve tanto em produção (`dist-web/`, gerado pelo
 * build do Vite, já incluso em `includeFiles` no vercel.json) quanto em
 * dev local (`web/public/`, antes do build existir). `null` se nenhum dos
 * dois existir — nesse caso o cabeçalho cai pra um texto "DGS" simples,
 * nunca quebra a geração do PDF por causa de um arquivo faltando.
 */
export function resolveLogoPath(): string | null {
  const candidates = [
    path.join(process.cwd(), "dist-web", "dgs-logo.png"),
    path.join(process.cwd(), "web", "public", "dgs-logo.png"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function createReportDocument(title: string): { doc: PDFKit.PDFDocument; finished: Promise<Buffer> } {
  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true, info: { Title: title } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  return { doc, finished };
}

export function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const bottom = doc.page.height - PAGE_MARGIN;
  if (doc.y + needed > bottom) doc.addPage();
}

export function ruleLine(doc: PDFKit.PDFDocument): void {
  doc
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y)
    .lineWidth(0.75)
    .strokeColor(RULE)
    .stroke();
}

/**
 * Faixa azul-marinho no topo com o logo (chip branco) à esquerda e o
 * título/subtítulo à direita. Deixa `doc.y` logo abaixo da faixa, pronto
 * pro bloco de metadados de cada relatório.
 */
export function drawBrandHeader(doc: PDFKit.PDFDocument, title: string, subtitle: string): void {
  doc.rect(0, 0, doc.page.width, 84).fill(HEADER_BG);

  // O arquivo já tem "D'ARTIBALE GESTÃO EM SAÚDE" desenhado dentro dele,
  // não precisa de tagline separada do lado.
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

  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13).text(title, PAGE_MARGIN, 22, {
    width: CONTENT_WIDTH,
    align: "right",
  });
  doc
    .fillColor("#c7c9cf")
    .font("Helvetica")
    .fontSize(9)
    .text(subtitle, PAGE_MARGIN, 40, { width: CONTENT_WIDTH, align: "right" });

  doc.y = 84 + 20;
  doc.x = PAGE_MARGIN;
}

/** Bloco de metadados (rótulo em caixa alta à esquerda, valor à direita) — um por linha. */
export function drawMetaRows(doc: PDFKit.PDFDocument, rows: [string, string][]): void {
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
}

/** Bloco de texto livre com rótulo acima (ex.: "MOTIVO INFORMADO" no Cancelamento). */
export function drawLabeledText(doc: PDFKit.PDFDocument, label: string, text: string): void {
  doc.moveDown(0.3);
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(9).text(label.toUpperCase(), PAGE_MARGIN, doc.y);
  doc.fillColor(INK).font("Helvetica").fontSize(10).text(text, PAGE_MARGIN, doc.y + 2, { width: CONTENT_WIDTH });
}

/** Separador — usado entre o bloco de metadados e o resto do documento. */
export function drawSeparator(doc: PDFKit.PDFDocument): void {
  doc.moveDown(0.8);
  ruleLine(doc);
  doc.moveDown(0.6);
}

export interface LegendItem {
  label: string;
  color: string;
  explanation: string;
}

/** Legenda em duas colunas, uma bolinha colorida por situação — mesma cor da barra da seção correspondente, mais abaixo. */
export function drawLegend(doc: PDFKit.PDFDocument, title: string, items: LegendItem[]): void {
  ensureSpace(doc, 130);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(title, PAGE_MARGIN, doc.y);
  doc.moveDown(0.4);

  const colWidth = CONTENT_WIDTH / 2;
  let startY = doc.y;
  let col = 0;
  let maxRowY = startY;

  for (const item of items) {
    const x = PAGE_MARGIN + col * colWidth;
    const y = startY;
    doc.circle(x + 4, y + 5, 4).fill(item.color);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5).text(item.label, x + 14, y, { continued: false });
    const textHeight = doc
      .font("Helvetica")
      .fontSize(8)
      .heightOfString(item.explanation, { width: colWidth - 20 });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(item.explanation, x + 14, y + 11, { width: colWidth - 20 });

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

export interface ReportColumn {
  label: string;
  /** Fração da largura útil (soma das colunas deve dar 1). */
  width: number;
}

function drawTableHeader(doc: PDFKit.PDFDocument, columns: ReportColumn[]): void {
  const y = doc.y;
  let x = PAGE_MARGIN;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED);
  for (const col of columns) {
    const width = CONTENT_WIDTH * col.width;
    doc.text(col.label.toUpperCase(), x + 2, y, { width: width - 4 });
    x += width;
  }
  doc.y = y + 14;
  doc.x = PAGE_MARGIN;
  ruleLine(doc);
  doc.moveDown(0.35);
}

export interface ReportGroup {
  label: string;
  color: string;
  bg: string;
  columns: ReportColumn[];
  /** Cada linha já formatada como texto, na mesma ordem de `columns`. */
  rows: string[][];
}

/**
 * Uma seção agrupada: barra colorida com nome + contagem, tabela com
 * paginação automática (repete o cabeçalho da tabela e uma barra mais fina
 * "(continuação)" quando a seção atravessa página).
 */
export function drawReportGroup(doc: PDFKit.PDFDocument, group: ReportGroup): void {
  ensureSpace(doc, 60);

  const barHeight = 22;
  doc.rect(PAGE_MARGIN, doc.y, CONTENT_WIDTH, barHeight).fill(group.bg);
  doc.rect(PAGE_MARGIN, doc.y, 3, barHeight).fill(group.color);
  doc
    .fillColor(group.color)
    .font("Helvetica-Bold")
    .fontSize(10.5)
    .text(`${group.label}  ·  ${group.rows.length} paciente${group.rows.length === 1 ? "" : "s"}`, PAGE_MARGIN + 12, doc.y + 6, {
      width: CONTENT_WIDTH - 20,
    });
  doc.y += barHeight + 8;
  doc.x = PAGE_MARGIN;

  drawTableHeader(doc, group.columns);

  const rowHeight = 18;
  group.rows.forEach((values, index) => {
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
      drawTableHeader(doc, group.columns);
    }

    const y = doc.y;
    if (index % 2 === 1) doc.rect(PAGE_MARGIN, y - 2, CONTENT_WIDTH, rowHeight).fill(ROW_ALT_BG);

    let x = PAGE_MARGIN;
    doc.font("Helvetica").fontSize(9).fillColor(INK);
    values.forEach((value, i) => {
      const width = CONTENT_WIDTH * group.columns[i]!.width;
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
 * cada uma das páginas já existentes, um PDF de 4 páginas saía com 4
 * páginas em branco extras no final. Zerar a margem inferior só durante
 * esse desenho evita o gatilho, sem afetar o layout do resto do conteúdo
 * (já desenhado antes disso).
 */
export function drawPageNumbers(doc: PDFKit.PDFDocument, lineForPage: (page: number, total: number) => string): void {
  const range = doc.bufferedPageRange();
  const originalBottomMargin = doc.page.margins.bottom;
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(lineForPage(i + 1, range.count), PAGE_MARGIN, doc.page.height - 30, {
        width: CONTENT_WIDTH,
        align: "center",
        lineBreak: false,
      });
    doc.page.margins.bottom = originalBottomMargin;
  }
}
