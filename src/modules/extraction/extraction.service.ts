import { AppError } from "@/middleware/errorHandler.js";
import { detectFormat } from "./parsers/detect.js";
import { parseCelk } from "./parsers/celk.js";
import { parseSisreg } from "./parsers/sisreg.js";
import { extractionResultSchema, type ExtractionResult } from "./extraction.schema.js";

/*
  Extração 100% local, sem API de IA (decisão de 2026-08-06 — ver CLAUDE.md).
  Só lê PDF nativo gerado pelos sistemas SISREG ou CELK; a prefeitura não
  manda mais foto. `extractionConfigured` fica sempre true: não depende de
  chave nenhuma, é só uma engrenagem interna.
*/

export const extractionConfigured = true;

/**
 * Lê uma lista (PDF nativo) e devolve os dados estruturados.
 *
 * Não decide nada sozinha: o resultado sempre passa pela tela de revisão
 * antes de virar disparo. Linhas com `confidence` baixa e o array
 * `warnings` são o que a revisão destaca.
 */
export async function extractList(
  file: Buffer,
  mimeType: string
): Promise<{ result: ExtractionResult; usage: { inputTokens: number; outputTokens: number } }> {
  if (mimeType !== "application/pdf") {
    throw new AppError(`Tipo de arquivo não suportado para extração: ${mimeType}. Envie um PDF.`, 400);
  }

  // O `pdf-parse` (via `pdfjs-dist`) tenta carregar `@napi-rs/canvas` assim
  // que é importado, pra ter DOMMatrix/ImageData/Path2D disponíveis — coisa
  // que só serve pra RENDERIZAR página como imagem, o que a gente nunca
  // faz (só lê texto). Na Vercel/Linux o binário nativo do canvas não fica
  // disponível no bundle serverless (funciona local no Windows, onde o
  // binário da plataforma está instalado) e o pdfjs-dist derruba o
  // processo inteiro com `ReferenceError: DOMMatrix is not defined` — tem
  // um `new DOMMatrix()` incondicional no topo do módulo de canvas dele,
  // sem checar se existe. Solução: definir um "boneco" dessas três classes
  // ANTES de importar, só o suficiente pra existir — o pdfjs-dist só
  // tenta carregar o canvas de verdade quando `globalThis.DOMMatrix` ainda
  // não existe, então isso evita a importação nativa por completo.
  for (const name of ["DOMMatrix", "ImageData", "Path2D"] as const) {
    if (!(name in globalThis)) {
      (globalThis as Record<string, unknown>)[name] = class {};
    }
  }

  // Import tardio: mesmo com o boneco acima, isola qualquer outra
  // superfície de erro desse pacote pra só quando um PDF é de fato
  // enviado, em vez de rodar no carregamento do módulo pra toda rota.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: file });
  let text: string;
  try {
    const parsed = await parser.getText();
    text = parsed.text;
  } catch (err) {
    throw new AppError(
      `Não deu pra ler o PDF: ${err instanceof Error ? err.message : "arquivo corrompido ou protegido"}.`,
      400
    );
  }

  if (!text.trim()) {
    throw new AppError(
      "O PDF não tem texto legível (provavelmente é uma imagem escaneada). O sistema só lê PDF nativo gerado pelo SISREG ou CELK.",
      400
    );
  }

  const format = detectFormat(text);
  const result: ExtractionResult =
    format === "CELK"
      ? parseCelk(text)
      : format === "SISREG"
        ? parseSisreg(text)
        : {
            sourceFormat: "OUTRO",
            municipality: null,
            executingUnit: null,
            doctor: null,
            procedure: null,
            rows: [],
            warnings: [
              "Formato do arquivo não reconhecido (não é SISREG nem CELK). Cadastre os agendamentos manualmente nesta lista.",
            ],
            unrecognized: [],
          };

  const validated = extractionResultSchema.safeParse(result);
  if (!validated.success) {
    console.error("[EXTRACTION] Resultado do parser fora do schema:", validated.error.flatten());
    throw new AppError("A leitura do arquivo não bateu com o formato esperado internamente.", 500);
  }

  // Não há chamada de rede: não existe "tokens gastos" de verdade. Os
  // campos ficam pra não quebrar quem lê o retorno (scripts/extrair.ts).
  return { result: validated.data, usage: { inputTokens: 0, outputTokens: 0 } };
}
