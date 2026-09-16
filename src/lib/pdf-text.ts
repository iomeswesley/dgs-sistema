import { AppError } from "@/middleware/errorHandler.js";

/**
 * Lê o texto de um PDF nativo. Compartilhado por qualquer fluxo que precise
 * ler PDF localmente sem IA (extração de listas, lista de referência de
 * horário) — ver `extraction.service.ts` pro motivo do "boneco" de
 * DOMMatrix/ImageData/Path2D abaixo (evita o `pdfjs-dist` tentar carregar
 * `@napi-rs/canvas`, que não tem binário nativo disponível na Vercel).
 */
export async function readPdfText(file: Buffer): Promise<string> {
  for (const name of ["DOMMatrix", "ImageData", "Path2D"] as const) {
    if (!(name in globalThis)) {
      (globalThis as Record<string, unknown>)[name] = class {};
    }
  }

  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: file });
  try {
    const parsed = await parser.getText();
    return parsed.text;
  } catch (err) {
    throw new AppError(
      `Não deu pra ler o PDF: ${err instanceof Error ? err.message : "arquivo corrompido ou protegido"}.`,
      400
    );
  }
}
