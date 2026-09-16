import { AppError } from "@/middleware/errorHandler.js";
import { readPdfText } from "@/lib/pdf-text.js";
import { detectFormat } from "./parsers/detect.js";
import { parseCelk } from "./parsers/celk.js";
import { parseSisreg } from "./parsers/sisreg.js";
import { parseTabular } from "./parsers/tabular.js";
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

  const text = await readPdfText(file);

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
        : format === "TABULAR"
          ? parseTabular(text)
          : {
              sourceFormat: "OUTRO",
              municipality: null,
              executingUnit: null,
              doctor: null,
              procedure: null,
              rows: [],
              warnings: [
                "Formato do arquivo não reconhecido (não é SISREG, CELK nem tabular). Cadastre os agendamentos manualmente nesta lista.",
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
