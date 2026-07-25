import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/config/env.js";
import { REPLY_CLASSIFICATION_SYSTEM_PROMPT, buildReplyClassificationPrompt } from "./replies.prompt.js";

export const aiClassificationConfigured = !!env.ANTHROPIC_API_KEY;

const MODEL = "claude-opus-5";

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
    return { intent: "unknown", rawConfidence: 0, reasoning: "Classificação por IA desligada." };
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

    if (message.stop_reason === "refusal") {
      return { intent: "unknown", rawConfidence: 0, reasoning: "Classificação recusada pelo provedor." };
    }

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { intent: "unknown", rawConfidence: 0, reasoning: "Resposta vazia do classificador." };
    }

    const parsed = resultSchema.safeParse(JSON.parse(textBlock.text));
    if (!parsed.success) {
      return { intent: "unknown", rawConfidence: 0, reasoning: "Resposta fora do formato esperado." };
    }

    // O corte de confiança vale mesmo quando o modelo escolheu confirm/refuse:
    // uma decisão de baixa confiança não deve virar ação automática.
    const intent = parsed.data.confidence >= CONFIDENCE_THRESHOLD ? parsed.data.intent : "unknown";

    return { intent, rawConfidence: parsed.data.confidence, reasoning: parsed.data.reasoning };
  } catch (err) {
    console.error("[REPLIES] Falha na classificação por IA:", (err as Error).message);
    return { intent: "unknown", rawConfidence: 0, reasoning: "Falha ao consultar o classificador." };
  }
}
