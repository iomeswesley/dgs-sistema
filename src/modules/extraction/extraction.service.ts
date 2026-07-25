import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env.js";
import { AppError } from "@/middleware/errorHandler.js";
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT } from "./extraction.prompt.js";
import { extractionResultSchema, type ExtractionResult } from "./extraction.schema.js";

export const extractionConfigured = !!env.ANTHROPIC_API_KEY;

const MODEL = "claude-opus-5";

// Listas grandes (o exemplo do CELK tem 3 páginas) geram saída longa. Com
// streaming o limite alto não esbarra em timeout de HTTP.
const MAX_TOKENS = 64000;

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

function isSupportedImage(mimeType: string): mimeType is SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Lê uma lista (PDF ou foto) e devolve os dados estruturados.
 *
 * Não decide nada sozinha: o resultado sempre passa pela tela de revisão
 * antes de virar disparo. Linhas com `confidence` baixa e o array `warnings`
 * são o que a revisão destaca.
 */
export async function extractList(
  file: Buffer,
  mimeType: string
): Promise<{ result: ExtractionResult; usage: { inputTokens: number; outputTokens: number } }> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError("Extração automática indisponível: ANTHROPIC_API_KEY não configurada.", 503);
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const data = file.toString("base64");

  let documentBlock: Anthropic.ContentBlockParam;
  if (mimeType === "application/pdf") {
    documentBlock = {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data },
    };
  } else if (isSupportedImage(mimeType)) {
    documentBlock = {
      type: "image",
      source: { type: "base64", media_type: mimeType, data },
    };
  } else {
    throw new AppError(`Tipo de arquivo não suportado para extração: ${mimeType}`, 400);
  }

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: EXTRACTION_SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMA },
    },
    messages: [
      {
        role: "user",
        // O documento vem antes do texto: é o que a Meta e a Anthropic
        // recomendam para leitura de arquivo, e melhora a extração.
        content: [documentBlock, { type: "text", text: EXTRACTION_USER_PROMPT }],
      },
    ],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new AppError("A leitura do arquivo foi recusada pelo provedor de IA.", 502);
  }
  if (message.stop_reason === "max_tokens") {
    throw new AppError(
      "A lista é grande demais para ser lida de uma vez. Divida o arquivo e envie por partes.",
      413
    );
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError("A resposta da extração não veio em JSON válido.", 502);
  }

  const validated = extractionResultSchema.safeParse(parsed);
  if (!validated.success) {
    console.error("[EXTRACTION] Resposta fora do schema:", validated.error.flatten());
    throw new AppError("A resposta da extração não bateu com o formato esperado.", 502);
  }

  return {
    result: validated.data,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  };
}

// Schema em JSON puro para o structured output. Escrito à mão em vez de
// derivado do zod: a API só aceita um subconjunto do JSON Schema (sem
// constraints numéricas, sem recursão) e `additionalProperties: false` é
// obrigatório em todo objeto.
const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    sourceFormat: { type: "string", enum: ["SISREG", "CELK", "OUTRO"] },
    municipality: { type: ["string", "null"] },
    executingUnit: { type: ["string", "null"] },
    doctor: { type: ["string", "null"] },
    procedure: { type: ["string", "null"] },
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          cns: { type: ["string", "null"] },
          birthDate: { type: ["string", "null"] },
          phones: { type: "array", items: { type: "string" } },
          procedure: { type: ["string", "null"] },
          doctor: { type: ["string", "null"] },
          scheduledAt: { type: ["string", "null"] },
          requestingUnit: { type: ["string", "null"] },
          isFirstVisit: { type: ["boolean", "null"] },
          confidence: { type: "number" },
          notes: { type: ["string", "null"] },
        },
        required: [
          "name",
          "cns",
          "birthDate",
          "phones",
          "procedure",
          "doctor",
          "scheduledAt",
          "requestingUnit",
          "isFirstVisit",
          "confidence",
          "notes",
        ],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["sourceFormat", "municipality", "executingUnit", "doctor", "procedure", "rows", "warnings"],
  additionalProperties: false,
} as const;
