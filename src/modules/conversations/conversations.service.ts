import type { TemplateKind } from "@prisma/client";
import { prisma } from "@/lib/prisma.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";
import { normalizePhone, phoneCandidates, formatPhone } from "@/lib/phone.js";
import { sendTemplate, sendText, type TemplateComponentParams } from "@/lib/whatsapp.js";
import { TEMPLATE_NAMES } from "@/lib/templates.js";
import { renderTemplateText } from "@/lib/whatsapp-templates.js";
import { AppError } from "@/middleware/errorHandler.js";

/*
  Tela de conversas: mostra TODA mensagem trocada com um número, não só a
  parte de confirmação de agendamento (que já tinha lugar próprio em
  Acompanhamento). `WhatsappMessage` já guarda cada mensagem — recebida e
  enviada — desde que a fila e o webhook existem; este módulo só agrupa por
  número e adiciona a resposta de texto livre, que não existia ainda.

  Não existe uma FK direta de WhatsappMessage pra Patient (ela liga em
  Appointment, que pode não existir pra uma mensagem qualquer) — o nome do
  paciente na lista de conversas é best-effort, casado por telefone.
*/

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

export interface ConversationSummary {
  phone: string;
  phoneFormatted: string;
  patientName: string | null;
  lastMessage: string | null;
  lastDirection: "ENVIADA" | "RECEBIDA";
  lastAt: Date;
  withinWindow: boolean;
  /**
   * Se o paciente já mandou alguma mensagem alguma vez (não só se está
   * dentro da janela agora). Distingue duas situações que a tela precisa
   * explicar diferente: "o paciente já respondeu antes, mas já passou de
   * 24h" (`withinWindow: false`, `everReplied: true`) vs "o paciente nunca
   * respondeu nada" (`everReplied: false`) — nesse segundo caso a Meta
   * bloqueia texto livre mesmo que a gente tenha mandado um template há
   * pouco tempo (mensagem de utilidade não abre a janela sozinha, só
   * resposta do paciente abre). Pedido do usuário em 2026-08-27: o aviso
   * "Fora da janela de 24h desde a última mensagem do paciente" é enganoso
   * quando não existe "última mensagem do paciente" nenhuma.
   */
  everReplied: boolean;
}

function previewBody(message: { body: string | null; template: string | null; buttonPayload: string | null }): string | null {
  if (message.body) return message.body;
  // Resposta por clique de botão (Sim/Não etc.) não vem em `body` — o texto
  // do botão fica em `buttonPayload`. Sem isso a mensagem aparecia em branco.
  if (message.buttonPayload) return message.buttonPayload;
  if (message.template) return `[modelo: ${message.template}]`;
  return null;
}

type ConversationMessageRow = {
  phone: string;
  body: string | null;
  template: string | null;
  buttonPayload: string | null;
  direction: "ENVIADA" | "RECEBIDA";
  createdAt: Date;
  appointment: { patient: { name: string; phones: string[] } | null } | null;
};

/**
 * Agrupa mensagens em conversas por número normalizado. Feito em aplicação
 * (não SQL) porque o telefone salvo varia de formato entre envio (E.164
 * sem "+") e recebimento (dígitos crus da Meta, às vezes sem o 9º dígito)
 * — normalizar em JS é mais simples que replicar isso em SQL.
 */
async function groupIntoConversations(messages: ConversationMessageRow[]): Promise<ConversationSummary[]> {
  const byPhone = new Map<string, ConversationSummary>();
  // Data da última mensagem RECEBIDA por telefone — separado da mensagem
  // mais recente (que pode ser nossa). A janela de 24h conta a partir do
  // paciente, não de quando a equipe respondeu por último.
  const lastInboundAt = new Map<string, Date>();
  // Nome do paciente, achado em QUALQUER mensagem daquele telefone dentro da
  // janela buscada — não só na mais recente. Bug real achado pelo usuário em
  // 2026-08-29 (Isolde Kindlein sumia da lista, mas aparecia ao abrir a
  // conversa): resposta de texto livre do paciente nunca tem `appointment`
  // vinculado (só mensagem de template tem), então se ela for a mais recente
  // o nome sumia mesmo com uma mensagem anterior linkada certinho — a thread
  // (`getThread()`, abaixo) já varria todas as mensagens à procura do nome,
  // só a lista que só olhava a última.
  const nameByPhone = new Map<string, string>();

  for (const message of messages) {
    const key = normalizePhone(message.phone)?.e164 ?? message.phone;

    if (message.direction === "RECEBIDA" && !lastInboundAt.has(key)) {
      lastInboundAt.set(key, message.createdAt);
    }

    const name = message.appointment?.patient?.name;
    if (name && !nameByPhone.has(key)) nameByPhone.set(key, name);

    if (byPhone.has(key)) continue; // já pegou a mais recente pra esse número (a mensagens estão em ordem desc)

    byPhone.set(key, {
      phone: key,
      phoneFormatted: formatPhone(key),
      patientName: null, // resolvido abaixo, depois de varrer todas as mensagens
      lastMessage: previewBody(message),
      lastDirection: message.direction,
      lastAt: message.createdAt,
      withinWindow: false, // recalculado abaixo, depois de varrer tudo
      everReplied: false, // idem
    });
  }

  for (const conversation of byPhone.values()) {
    conversation.patientName = nameByPhone.get(conversation.phone) ?? null;

    const lastInbound = lastInboundAt.get(conversation.phone);
    conversation.everReplied = !!lastInbound;
    conversation.withinWindow = !!lastInbound && Date.now() - lastInbound.getTime() < WINDOW_24H_MS;
  }

  // Nome do paciente pode não ter vindo por Appointment (mensagem sem
  // agendamento casado) — tenta achar por telefone no cadastro antes de
  // devolver "sem nome".
  const withoutName = [...byPhone.values()].filter((c) => !c.patientName);
  if (withoutName.length > 0) {
    const candidates = withoutName.flatMap((c) => phoneCandidates(c.phone));
    const patients = await prisma.patient.findMany({
      where: { phones: { hasSome: candidates } },
      select: { name: true, phones: true },
    });
    for (const conversation of withoutName) {
      const match = patients.find((p) => p.phones.some((phone) => phoneCandidates(conversation.phone).includes(phone)));
      if (match) conversation.patientName = match.name;
    }
  }

  return [...byPhone.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

const CONVERSATION_MESSAGE_SELECT = {
  phone: true,
  body: true,
  template: true,
  buttonPayload: true,
  direction: true,
  createdAt: true,
  appointment: { select: { patient: { select: { name: true, phones: true } } } },
} as const;

/**
 * Lista as conversas. Sem `search`: as `limit` mais recentemente ativas,
 * olhando só as 1000 mensagens mais novas do sistema — rápido, é a tela
 * abrindo normal.
 *
 * Com `search`: busca de verdade no HISTÓRICO INTEIRO, não só nas
 * recentes. Bug real achado pelo usuário em 2026-09-02: a busca da tela
 * (Conversas.tsx) sempre filtrou só dentro da lista já carregada (as 200
 * mais recentes) — uma conversa com a última mensagem há alguns dias,
 * atrás de mais de 200 outras mais novas, nunca aparecia, MESMO buscando
 * pelo nome exato do paciente (achado com "ISABELA DE FARIAS RAMOS": a
 * 372ª conversa mais recente, confirmada existir e correta no banco,
 * invisível na busca). Agora a busca por nome/telefone resolve os
 * telefones candidatos primeiro (via `Patient.name`/`phones`, sem limite
 * de recência) e só então busca as mensagens desses números — chega em
 * qualquer conversa, não só nas mais recentes.
 */
export async function listConversations(limit = 200, search?: string): Promise<ConversationSummary[]> {
  const query = search?.trim();
  if (!query) {
    const messages = await prisma.whatsappMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: CONVERSATION_MESSAGE_SELECT,
    });
    const conversations = await groupIntoConversations(messages);
    return conversations.slice(0, limit);
  }

  const digits = query.replace(/\D/g, "");
  const patients = await prisma.patient.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        ...(digits.length >= 4 ? [{ phones: { hasSome: phoneCandidates(digits) } }] : []),
      ],
    },
    select: { phones: true },
  });
  const candidatePhones = new Set(patients.flatMap((p) => p.phones.flatMap((phone) => phoneCandidates(phone))));

  // Nem paciente cadastrado bateu, nem dígito suficiente pra buscar direto
  // no telefone da mensagem — nada a fazer (evita um `OR: []` vazio, que o
  // Prisma não aceita).
  if (candidatePhones.size === 0 && digits.length < 4) return [];

  const messages = await prisma.whatsappMessage.findMany({
    where: {
      OR: [
        ...(candidatePhones.size > 0 ? [{ phone: { in: [...candidatePhones] } }] : []),
        // Cobre também quem já escreveu mas nunca virou Patient (nenhum
        // agendamento vinculado ainda) — busca direto pelo dígito no
        // telefone salvo da mensagem.
        ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: CONVERSATION_MESSAGE_SELECT,
  });
  if (messages.length === 0) return [];

  const conversations = await groupIntoConversations(messages);
  return conversations.slice(0, limit);
}

export interface ThreadMessage {
  id: number;
  direction: "ENVIADA" | "RECEBIDA";
  body: string | null;
  template: string | null;
  buttonPayload: string | null;
  status: string;
  createdAt: Date;
  /**
   * Só indica SE existe mídia baixada (imagem/áudio/figurinha/documento) —
   * o arquivo em si é servido à parte por `GET /api/conversations/:phone/
   * messages/:id/media`, nunca inline aqui (evita carregar bytes de mídia
   * na lista da conversa inteira toda vez que ela é aberta).
   */
  hasMedia: boolean;
  mediaMimeType: string | null;
}

export async function getThread(rawPhone: string): Promise<{ patientName: string | null; messages: ThreadMessage[] }> {
  const key = normalizePhone(rawPhone)?.e164 ?? rawPhone;
  const candidates = phoneCandidates(key);

  const rows = await prisma.whatsappMessage.findMany({
    where: { phone: { in: candidates } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      direction: true,
      body: true,
      template: true,
      buttonPayload: true,
      status: true,
      createdAt: true,
      mediaMimeType: true,
      // Não seleciona `mediaData` aqui — pode ser um arquivo de vários MB, e
      // a lista de mensagens não precisa do conteúdo, só de saber que existe.
      appointment: { select: { patient: { select: { name: true } } } },
    },
  });
  // `mediaData` fica de fora do select acima (custo de banda), então
  // descobre se existe com uma query separada, só de ids — leve mesmo com
  // muita mensagem, porque não traz bytes nenhum.
  const idsWithMedia = new Set(
    (
      await prisma.whatsappMessage.findMany({
        where: { phone: { in: candidates }, mediaData: { not: null } },
        select: { id: true },
      })
    ).map((m) => m.id)
  );
  const messages = rows.map((m) => ({ ...m, hasMedia: idsWithMedia.has(m.id) }));

  let patientName = messages.find((m) => m.appointment?.patient?.name)?.appointment?.patient?.name ?? null;
  if (!patientName) {
    const patient = await prisma.patient.findFirst({ where: { phones: { hasSome: candidates } }, select: { name: true } });
    patientName = patient?.name ?? null;
  }

  return { patientName, messages: messages.map(({ appointment: _appointment, ...m }) => m) };
}

export interface MessageMedia {
  data: Buffer;
  mimeType: string;
  filename: string | null;
}

/**
 * Busca a mídia de uma mensagem específica pra servir sob demanda (ver rota
 * `GET /api/conversations/:phone/messages/:messageId/media`). Confere que a
 * mensagem é mesmo desse telefone (mesmos candidatos de formato usados em
 * todo o resto do módulo) — não deixa buscar mídia de outro número só
 * sabendo o id da mensagem.
 */
export async function getMessageMedia(rawPhone: string, messageId: number): Promise<MessageMedia | null> {
  const key = normalizePhone(rawPhone)?.e164 ?? rawPhone;
  const candidates = phoneCandidates(key);

  const message = await prisma.whatsappMessage.findFirst({
    where: { id: messageId, phone: { in: candidates } },
    select: { mediaData: true, mediaMimeType: true, mediaFilename: true },
  });
  if (!message?.mediaData || !message.mediaMimeType) return null;

  return { data: Buffer.from(message.mediaData), mimeType: message.mediaMimeType, filename: message.mediaFilename };
}

/**
 * Manda texto livre — só funciona dentro da janela de 24h da última
 * mensagem RECEBIDA desse número (regra da Meta: fora da janela só
 * template). Mesma lógica que `withinWindow` na lista de conversas.
 */
export async function sendReply(rawPhone: string, text: string): Promise<void> {
  const key = normalizePhone(rawPhone)?.e164 ?? rawPhone;
  const candidates = phoneCandidates(key);

  const lastInbound = await prisma.whatsappMessage.findFirst({
    where: { phone: { in: candidates }, direction: "RECEBIDA" },
    orderBy: { createdAt: "desc" },
  });
  const withinWindow = lastInbound && Date.now() - lastInbound.createdAt.getTime() < WINDOW_24H_MS;
  if (!withinWindow) {
    throw new AppError(
      lastInbound
        ? "Fora da janela de 24h desde a última mensagem do paciente — a Meta só aceita template pra reabrir a conversa."
        : "O paciente ainda não respondeu nenhuma mensagem — a Meta só libera texto livre depois da primeira resposta dele (template não abre a conversa sozinho, mesmo enviado há pouco tempo).",
      409
    );
  }

  const result = await sendText(key, text);
  await prisma.whatsappMessage.create({
    data: {
      clientId: requireActiveClientId(),
      wamid: result.wamid,
      direction: "ENVIADA",
      phone: key,
      body: text,
      status: "ENVIADO",
    },
  });
}

/**
 * Manda um template pra reabrir a conversa — funciona a qualquer momento,
 * inclusive fora da janela de 24h (é justamente pra isso que o template
 * existe: é a única forma de mensagem iniciada por nós que a Meta aceita
 * fora da janela). Usado pelo botão "Enviar template" em Conversas, que
 * aparece quando o campo de texto livre está desabilitado.
 */
export async function sendTemplateReply(
  rawPhone: string,
  template: TemplateKind,
  params: TemplateComponentParams
): Promise<void> {
  const key = normalizePhone(rawPhone)?.e164 ?? rawPhone;

  const result = await sendTemplate(key, TEMPLATE_NAMES[template], params);
  await prisma.whatsappMessage.create({
    data: {
      clientId: requireActiveClientId(),
      wamid: result.wamid,
      direction: "ENVIADA",
      template,
      phone: key,
      body: renderTemplateText(TEMPLATE_NAMES[template], params.header, params.body),
      status: "ENVIADO",
    },
  });
}
