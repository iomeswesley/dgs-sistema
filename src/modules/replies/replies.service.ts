import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/config/env.js";
import { REPLY_CLASSIFICATION_SYSTEM_PROMPT, buildReplyClassificationPrompt } from "./replies.prompt.js";

export const aiClassificationConfigured = !!env.ANTHROPIC_API_KEY;

// Haiku 4.5 (não Opus) de propósito: é uma classificação de 3 categorias
// (confirm/refuse/unknown), não uma tarefa que precise de raciocínio pesado
// — e o prompt já pede pra errar pro lado seguro ("unknown") quando não tem
// certeza, então o corte de confiança (CONFIDENCE_THRESHOLD) protege contra
// decisão errada independente do modelo. Rodar isso em Opus custava 5x mais
// caro nos dois lados (tokens de entrada e saída) e, sem `thinking` setado,
// ainda ligava raciocínio adaptativo por padrão (cobrado como saída) numa
// tarefa que não precisa disso — achado em 2026-09-13 investigando um gasto
// de $0,13/dia na API da Anthropic que não tinha explicação óbvia.
const MODEL = "claude-haiku-4-5";

/** Abaixo disso o sistema trata como "unknown" mesmo que o modelo tenha decidido. */
const CONFIDENCE_THRESHOLD = 0.7;

const resultSchema = z.object({
  intent: z.enum(["confirm", "refuse", "unknown"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export type AiReplyIntent = "confirm" | "refuse" | "unknown";

export interface AiClassification {
  intent: AiReplyIntent;
  /** Confiança bruta do modelo, antes do corte do threshold. */
  rawConfidence: number;
  reasoning: string;
  /**
   * Tokens de verdade cobrados nesta chamada (`response.usage`), pra dar
   * custo exato por dia sem precisar estimar — motivado pela investigação
   * de 2026-09-13 (gasto de $0,13/dia sem explicação óbvia, resolvida na
   * época só por estimativa porque nada disso era gravado ainda). `null`
   * quando a chamada nem saiu (sem `ANTHROPIC_API_KEY`, recusa, erro de
   * rede) — nesses casos não há tokens cobrados.
   */
  usage: { model: string; inputTokens: number; outputTokens: number } | null;
}

const JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["confirm", "refuse", "unknown"] },
    confidence: { type: "number" },
    reasoning: { type: "string" },
  },
  required: ["intent", "confidence", "reasoning"],
  additionalProperties: false,
} as const;

/**
 * Classifica uma resposta em texto livre que `classifyReply()` não resolveu
 * sozinha. Usada só como segunda tentativa — o caminho barato e determinístico
 * continua sendo o primeiro (ver src/lib/templates.ts).
 *
 * Sem `ANTHROPIC_API_KEY`, devolve `unknown` sem chamar nada: a resposta
 * fica para a equipe resolver na tela, que é o comportamento seguro.
 */
export async function classifyReplyWithAI(text: string): Promise<AiClassification> {
  if (!env.ANTHROPIC_API_KEY) {
    return { intent: "unknown", rawConfidence: 0, reasoning: "Classificação por IA desligada.", usage: null };
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: REPLY_CLASSIFICATION_SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: JSON_SCHEMA } },
      messages: [{ role: "user", content: buildReplyClassificationPrompt(text) }],
    });

    // Cobrado mesmo quando a chamada termina em refusal/formato inesperado
    // abaixo — captura antes de qualquer `return` pra nunca perder o dado
    // de custo por causa de uma resposta que não deu em classificação.
    const usage = { model: MODEL, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };

    if (message.stop_reason === "refusal") {
      return { intent: "unknown", rawConfidence: 0, reasoning: "Classificação recusada pelo provedor.", usage };
    }

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { intent: "unknown", rawConfidence: 0, reasoning: "Resposta vazia do classificador.", usage };
    }

    const parsed = resultSchema.safeParse(JSON.parse(textBlock.text));
    if (!parsed.success) {
      return { intent: "unknown", rawConfidence: 0, reasoning: "Resposta fora do formato esperado.", usage };
    }

    // O corte de confiança vale mesmo quando o modelo escolheu confirm/refuse:
    // uma decisão de baixa confiança não deve virar ação automática.
    const intent = parsed.data.confidence >= CONFIDENCE_THRESHOLD ? parsed.data.intent : "unknown";

    return { intent, rawConfidence: parsed.data.confidence, reasoning: parsed.data.reasoning, usage };
  } catch (err) {
    console.error("[REPLIES] Falha na classificação por IA:", (err as Error).message);
    // Erro de rede/API — a chamada pode não ter nem saído (sem cobrança) ou
    // ter falhado depois de cobrar; sem `usage` na exceção do SDK, não dá
    // pra saber qual dos dois. Tratado como sem custo (o caso mais comum:
    // timeout, chave inválida, rate limit — nenhum chega a gerar tokens de
    // saída cobráveis).
    return { intent: "unknown", rawConfidence: 0, reasoning: "Falha ao consultar o classificador.", usage: null };
  }
}
