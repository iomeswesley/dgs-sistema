import { prisma } from "@/lib/prisma.js";
import { env } from "@/config/env.js";
import { recordAudit } from "@/modules/audit/audit.service.js";

const GRAPH_API_VERSION = "v21.0";

export interface WhatsappCredentials {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string | null;
}

export interface ConnectionStatus {
  connected: boolean;
  source: "signup" | "env" | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  businessName: string | null;
  connectedAt: Date | null;
}

/**
 * Credenciais ativas: a conta conectada via Embedded Signup tem prioridade
 * sobre o .env — o .env só serve pra sandbox/dev antes de qualquer conexão
 * existir. Sempre no máximo uma linha na tabela (ver comentário no schema).
 */
export async function getActiveCredentials(): Promise<WhatsappCredentials | null> {
  const account = await prisma.whatsappAccount.findFirst({ orderBy: { connectedAt: "desc" } });
  if (account) {
    return { accessToken: account.accessToken, phoneNumberId: account.phoneNumberId, wabaId: account.wabaId };
  }
  if (env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    return { accessToken: env.WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, wabaId: null };
  }
  return null;
}

export async function isWhatsappConfigured(): Promise<boolean> {
  return (await getActiveCredentials()) !== null;
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const account = await prisma.whatsappAccount.findFirst({ orderBy: { connectedAt: "desc" } });
  if (account) {
    return {
      connected: true,
      source: "signup",
      wabaId: account.wabaId,
      phoneNumberId: account.phoneNumberId,
      businessName: account.businessName,
      connectedAt: account.connectedAt,
    };
  }
  if (env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      connected: true,
      source: "env",
      wabaId: null,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      businessName: null,
      connectedAt: null,
    };
  }
  return { connected: false, source: null, wabaId: null, phoneNumberId: null, businessName: null, connectedAt: null };
}

/**
 * Troca o `code` do Embedded Signup por um token de longa duração (System
 * User, escopado à WABA conectada — não expira sozinho, só se revogado).
 * Exige WHATSAPP_APP_ID + WHATSAPP_APP_SECRET do app "dgs-system".
 */
export async function exchangeSignupCode(code: string): Promise<string> {
  if (!env.WHATSAPP_APP_ID || !env.WHATSAPP_APP_SECRET) {
    throw new Error("WHATSAPP_APP_ID/WHATSAPP_APP_SECRET não configurados — necessários pra troca do code.");
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", env.WHATSAPP_APP_ID);
  url.searchParams.set("client_secret", env.WHATSAPP_APP_SECRET);
  url.searchParams.set("code", code);

  const res = await fetch(url);
  const payload = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } };
  if (!res.ok || !payload.access_token) {
    throw new Error(`Falha ao trocar o code por token: ${payload.error?.message ?? res.status}`);
  }
  return payload.access_token;
}

/** Inscreve o app pra receber webhooks dessa WABA (obrigatório após conectar). */
export async function subscribeAppToWaba(wabaId: string, accessToken: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(`Falha ao inscrever o app na WABA: ${JSON.stringify(payload)}`);
  }
}

export interface SaveConnectionInput {
  wabaId: string;
  phoneNumberId: string;
  businessName: string | null;
  accessToken: string;
  connectedById: number;
}

/** Substitui a conexão ativa (só existe uma por vez, ver schema). */
export async function saveConnection(input: SaveConnectionInput): Promise<void> {
  await prisma.$transaction([
    prisma.whatsappAccount.deleteMany({}),
    prisma.whatsappAccount.create({
      data: {
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        businessName: input.businessName,
        accessToken: input.accessToken,
        connectedById: input.connectedById,
      },
    }),
  ]);

  await recordAudit({
    userId: input.connectedById,
    action: "whatsapp.connected",
    entity: "WhatsappAccount",
    metadata: { wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, businessName: input.businessName },
  });
}

export async function disconnectAccount(userId: number): Promise<void> {
  await prisma.whatsappAccount.deleteMany({});
  await recordAudit({ userId, action: "whatsapp.disconnected", entity: "WhatsappAccount" });
}
