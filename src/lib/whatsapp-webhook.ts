/*
  Leitura do webhook da Meta — separado de `whatsapp.ts` (que envia mensagem
  de verdade e importa `@/config/env`) só pra poder testar essa parte, que é
  lógica pura, sem precisar de `DATABASE_URL`/`SESSION_SECRET` configurados
  (o jeito que os outros testes do projeto ficam livre de banco/env).
*/

export interface InboundReply {
  wamid: string;
  from: string;
  /** Payload do botão de resposta rápida, quando o paciente clicou. */
  buttonPayload: string | null;
  /** Texto, quando o paciente escreveu em vez de clicar. */
  text: string | null;
  /**
   * Descrição legível pra tipo de mensagem que não é texto/botão (imagem,
   * áudio, figurinha, localização, contato, reação…) — nunca o conteúdo em
   * si (sem baixar mídia nenhuma, só o que o próprio payload do webhook já
   * inclui, tipo legenda/nome de arquivo). Só existe quando `text` e
   * `buttonPayload` são os dois `null`; serve só pra exibição em Conversas,
   * nunca entra em `classifyReply`/IA (isso continua olhando só `text`).
   * Antes disso, qualquer coisa que não fosse texto ou clique de botão
   * virava "—" na tela, sem indicar o que o paciente mandou de verdade
   * (achado pelo usuário em 2026-08-27).
   */
  contentDescription: string | null;
  /**
   * Id da mídia na Meta (imagem, vídeo, áudio, documento ou figurinha) —
   * `null` pra qualquer outro tipo. Quem baixa de fato é `whatsapp.ts`
   * (`downloadMedia()`, precisa de credencial/rede); aqui é só extração do
   * payload, sem I/O nenhum.
   */
  mediaId: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
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
    image?: { id?: string; mime_type?: string; caption?: string };
    video?: { id?: string; mime_type?: string; caption?: string };
    audio?: { id?: string; mime_type?: string; voice?: boolean };
    document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
    sticker?: { id?: string; mime_type?: string };
    location?: { name?: string };
    contacts?: { name?: { formatted_name?: string } }[];
    reaction?: { emoji?: string };
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

/**
 * Descreve, pra exibição, uma mensagem que não é texto nem clique de botão
 * — nunca baixa mídia nenhuma, só usa o que o webhook da Meta já manda
 * (legenda, nome de arquivo, nome do contato, emoji da reação). `null` pros
 * tipos já tratados em outro lugar (`text`, `button`, `interactive`) ou
 * quando o tipo não é reconhecido de jeito nenhum.
 */
function describeNonTextContent(message: NonNullable<WebhookValue["messages"]>[number]): string | null {
  switch (message.type) {
    case "image":
      return `📷 Imagem${message.image?.caption ? `: ${message.image.caption}` : ""}`;
    case "video":
      return `🎥 Vídeo${message.video?.caption ? `: ${message.video.caption}` : ""}`;
    case "audio":
      return message.audio?.voice ? "🎤 Mensagem de voz" : "🎵 Áudio";
    case "document":
      return `📄 Documento${message.document?.filename ? `: ${message.document.filename}` : ""}`;
    case "sticker":
      return "🙂 Figurinha";
    case "location":
      return `📍 Localização${message.location?.name ? `: ${message.location.name}` : ""}`;
    case "contacts": {
      const name = message.contacts?.[0]?.name?.formatted_name;
      return `👤 Contato compartilhado${name ? `: ${name}` : ""}`;
    }
    case "reaction":
      return message.reaction?.emoji ? `Reagiu com ${message.reaction.emoji}` : "Reagiu a uma mensagem";
    case "text":
    case "button":
    case "interactive":
      return null; // já tratados por `text`/`buttonPayload`
    default:
      return "[tipo de mensagem não suportado]";
  }
}

/**
 * Referência da mídia baixável (não localização/contato/reação, que não têm
 * arquivo nenhum pra baixar) — `null` quando o tipo não carrega mídia.
 */
function extractMediaRef(
  message: NonNullable<WebhookValue["messages"]>[number]
): { id: string; mimeType: string | null; filename: string | null } | null {
  const media = message.image ?? message.video ?? message.audio ?? message.document ?? message.sticker;
  if (!media?.id) return null;
  return {
    id: media.id,
    mimeType: media.mime_type ?? null,
    // Só `document` carrega nome de arquivo de verdade na Meta.
    filename: message.document?.filename ?? null,
  };
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
      const mediaRef = extractMediaRef(message);

      replies.push({
        wamid: message.id,
        from: message.from,
        buttonPayload,
        text: message.text?.body ?? null,
        contentDescription: describeNonTextContent(message),
        mediaId: mediaRef?.id ?? null,
        mediaMimeType: mediaRef?.mimeType ?? null,
        mediaFilename: mediaRef?.filename ?? null,
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
