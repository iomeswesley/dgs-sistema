import { prisma } from "@/lib/prisma.js";
import { normalizePhone, phoneCandidates, formatPhone } from "@/lib/phone.js";
import { sendText } from "@/lib/whatsapp.js";
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
}

function previewBody(message: { body: string | null; template: string | null }): string | null {
  if (message.body) return message.body;
  if (message.template) return `[modelo: ${message.template}]`;
  return null;
}

/**
 * Agrupa as mensagens mais recentes por número normalizado. Feito em
 * aplicação (não SQL) porque o telefone salvo varia de formato entre
 * envio (E.164 sem "+") e recebimento (dígitos crus da Meta, às vezes sem
 * o 9º dígito) — normalizar em JS é mais simples que replicar isso em SQL,
 * e o volume de mensagens não justifica a complexidade.
 */
export async function listConversations(limit = 200): Promise<ConversationSummary[]> {
  const messages = await prisma.whatsappMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: {
      phone: true,
      body: true,
      template: true,
      direction: true,
      createdAt: true,
      appointment: { select: { patient: { select: { name: true, phones: true } } } },
    },
  });

  const byPhone = new Map<string, ConversationSummary>();
  for (const message of messages) {
    const key = normalizePhone(message.phone)?.e164 ?? message.phone;
    if (byPhone.has(key)) continue; // já pegou a mais recente pra esse número

    byPhone.set(key, {
      phone: key,
      phoneFormatted: formatPhone(key),
      patientName: message.appointment?.patient?.name ?? null,
      lastMessage: previewBody(message),
      lastDirection: message.direction,
      lastAt: message.createdAt,
      withinWindow: message.direction === "RECEBIDA" && Date.now() - message.createdAt.getTime() < WINDOW_24H_MS,
    });
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

  return [...byPhone.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime()).slice(0, limit);
}

export interface ThreadMessage {
  id: number;
  direction: "ENVIADA" | "RECEBIDA";
  body: string | null;
  template: string | null;
  status: string;
  createdAt: Date;
}

export async function getThread(rawPhone: string): Promise<{ patientName: string | null; messages: ThreadMessage[] }> {
  const key = normalizePhone(rawPhone)?.e164 ?? rawPhone;
  const candidates = phoneCandidates(key);

  const messages = await prisma.whatsappMessage.findMany({
    where: { phone: { in: candidates } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      direction: true,
      body: true,
      template: true,
      status: true,
      createdAt: true,
      appointment: { select: { patient: { select: { name: true } } } },
    },
  });

  let patientName = messages.find((m) => m.appointment?.patient?.name)?.appointment?.patient?.name ?? null;
  if (!patientName) {
    const patient = await prisma.patient.findFirst({ where: { phones: { hasSome: candidates } }, select: { name: true } });
    patientName = patient?.name ?? null;
  }

  return { patientName, messages: messages.map(({ appointment: _appointment, ...m }) => m) };
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
      "Fora da janela de 24h desde a última mensagem do paciente — a Meta só aceita template pra reabrir a conversa.",
      409
    );
  }

  const result = await sendText(key, text);
  await prisma.whatsappMessage.create({
    data: { wamid: result.wamid, direction: "ENVIADA", phone: key, body: text, status: "ENVIADO" },
  });
}
