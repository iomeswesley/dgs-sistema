import crypto from "node:crypto";
import { env, isProduction, whatsappConfigured } from "@/config/env.js";

const GRAPH_API_VERSION = "v21.0";

export interface TemplateComponentParams {
  /** Variáveis do header, na ordem ({{1}}, {{2}}...). */
  header?: string[];
  /** Variáveis do corpo, na ordem. */
  body: string[];
}

export interface SendResult {
  wamid: string | null;
  /** true quando o envio foi só logado (sem credenciais configuradas). */
  stubbed: boolean;
}

/**
 * Envia um Message Template aprovado. Todo disparo do sistema passa por aqui:
 * mensagem iniciada por nós, fora da janela de 24h, só chega como template.
 *
 * Os botões de resposta rápida fazem parte do template aprovado na Meta e não
 * são enviados aqui — só as variáveis. A resposta do paciente chega depois no
 * webhook como `button_reply`.
 *
 * Sem credenciais configuradas, não envia nada e devolve `stubbed: true` —
 * permite desenvolver o fluxo inteiro sem risco de mandar mensagem real pra
 * telefone de paciente.
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  params: TemplateComponentParams,
  languageCode = "pt_BR"
): Promise<SendResult> {
  if (!whatsappConfigured) {
    console.log(`[WHATSAPP:STUB] template "${templateName}" -> ${to}`, params);
    return { wamid: null, stubbed: true };
  }

  const components: unknown[] = [];
  if (params.header?.length) {
    components.push({
      type: "header",
      parameters: params.header.map((text) => ({ type: "text", text })),
    });
  }
  components.push({
    type: "body",
    parameters: params.body.map((text) => ({ type: "text", text })),
  });

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components,
        },
      }),
    }
  );

  const payload = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { message?: string; code?: number };
  };

  if (!res.ok) {
    const detail = payload.error?.message ?? JSON.stringify(payload);
    throw new WhatsappSendError(
      `Falha ao enviar template "${templateName}" (${res.status}): ${detail}`,
      payload.error?.code ? String(payload.error.code) : undefined
    );
  }

  return { wamid: payload.messages?.[0]?.id ?? null, stubbed: false };
}

export class WhatsappSendError extends Error {
  code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "WhatsappSendError";
    this.code = code;
  }
}

/**
 * Envia texto livre. Só funciona dentro da janela de 24h desde a última
 * mensagem do paciente — fora dela a Meta rejeita. Usado só para responder
 * quem escreveu de volta, nunca para disparo.
 */
export async function sendText(to: string, text: string): Promise<SendResult> {
  if (!whatsappConfigured) {
    console.log(`[WHATSAPP:STUB] texto -> ${to}: ${text}`);
    return { wamid: null, stubbed: true };
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    }
  );

  const payload = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok) {
    throw new WhatsappSendError(`Falha ao enviar texto (${res.status}): ${payload.error?.message ?? ""}`);
  }
  return { wamid: payload.messages?.[0]?.id ?? null, stubbed: false };
}

/**
 * Valida a assinatura HMAC que a Meta manda no header X-Hub-Signature-256.
 *
 * Fail-closed em produção: sem APP_SECRET configurado, rejeita tudo. (Na
 * barbearia-saas essa mesma função já aceitou requisição sem assinatura
 * quando a env sumia — foi corrigido lá e nasce corrigido aqui.)
 */
export function verifyWebhookSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
  if (!env.WHATSAPP_APP_SECRET) return !isProduction;
  if (!rawBody || !signatureHeader?.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

/* ------------------------------------------------------------------ */
/* Leitura do webhook                                                  */
/* ------------------------------------------------------------------ */

export interface InboundReply {
  wamid: string;
  from: string;
  /** Payload do botão de resposta rápida, quando o paciente clicou. */
  buttonPayload: string | null;
  /** Texto, quando o paciente escreveu em vez de clicar. */
  text: string | null;
  timestamp: Date;
}

export interface StatusUpdate {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: Date;
  errorCode: string | null;
  errorMessage: string | null;
}

interface WebhookValue {
  messages?: {
    id: string;
    from: string;
    timestamp: string;
    type: string;
    text?: { body: string };
    button?: { payload?: string; text?: string };
    interactive?: { type: string; button_reply?: { id: string; title: string } };
  }[];
  statuses?: {
    id: string;
    status: string;
    timestamp: string;
    errors?: { code?: number; title?: string; message?: string }[];
  }[];
}

function parseTimestamp(value: string): Date {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

/** Extrai as respostas de pacientes de um payload do webhook. */
export function parseInboundReplies(payload: unknown): InboundReply[] {
  const replies: InboundReply[] = [];

  for (const value of extractValues(payload)) {
    for (const message of value.messages ?? []) {
      // Template com quick reply chega como `button` (templates) ou
      // `interactive.button_reply` (mensagens interativas) — os dois formatos
      // existem e a Meta escolhe conforme o tipo de mensagem enviada.
      const buttonPayload =
        message.button?.payload ?? message.button?.text ?? message.interactive?.button_reply?.title ?? null;

      replies.push({
        wamid: message.id,
        from: message.from,
        buttonPayload,
        text: message.text?.body ?? null,
        timestamp: parseTimestamp(message.timestamp),
      });
    }
  }

  return replies;
}

/**
 * Extrai as atualizações de entrega. Diferente da barbearia-saas (que ignora
 * `statuses`), aqui isso é parte do produto: telefone errado na lista da
 * prefeitura é rotina, e saber que a mensagem não chegou é o que vira o
 * indicador de qualidade da lista devolvido à secretaria.
 */
export function parseStatusUpdates(payload: unknown): StatusUpdate[] {
  const updates: StatusUpdate[] = [];

  for (const value of extractValues(payload)) {
    for (const status of value.statuses ?? []) {
      if (!["sent", "delivered", "read", "failed"].includes(status.status)) continue;
      const error = status.errors?.[0];
      updates.push({
        wamid: status.id,
        status: status.status as StatusUpdate["status"],
        timestamp: parseTimestamp(status.timestamp),
        errorCode: error?.code != null ? String(error.code) : null,
        errorMessage: error?.message ?? error?.title ?? null,
      });
    }
  }

  return updates;
}

function extractValues(payload: unknown): WebhookValue[] {
  const body = payload as { entry?: { changes?: { value?: WebhookValue }[] }[] } | null;
  const values: WebhookValue[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.value) values.push(change.value);
    }
  }
  return values;
}
