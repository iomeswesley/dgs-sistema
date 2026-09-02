import { prisma } from "@/lib/prisma.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";
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
  /** Número de verdade formatado pela Meta (ex.: "+55 47 8865-6379") — o phoneNumberId é só um ID interno, não diz nada pro time/cliente. */
  displayPhoneNumber: string | null;
  businessName: string | null;
  connectedAt: Date | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  dailyLimit: number;
}

export interface WhatsappAccountSummary {
  id: number;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  businessName: string | null;
  label: string | null;
  active: boolean;
  connectedAt: Date;
}

/**
 * O tier já reflete o limite atual do número — a Meta sobe sozinha conforme
 * o histórico de qualidade (250 -> 1K -> 10K -> 100K -> ilimitado). Nomes de
 * enum variam um pouco entre versões da API, então mapeia os dois jeitos.
 */
const TIER_LIMITS: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  TIER_UNLIMITED: 1_000_000,
  UNLIMITED: 1_000_000,
};

export interface PhoneNumberStatus {
  qualityRating: string | null;
  messagingLimitTier: string | null;
  dailyLimit: number;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

const STATUS_CACHE_MS = 5 * 60 * 1000;
// Cacheado por phoneNumberId (não só um valor único) — a tela de contas
// conectadas pode ter mais de um número (failover), cada um com seu
// próprio display_phone_number, sem depender de qual está "ativo" agora.
const phoneStatusCache = new Map<string, { value: PhoneNumberStatus; fetchedAt: number }>();

/**
 * Consulta display_phone_number, verified_name, quality_rating e
 * messaging_limit_tier na Graph API pra um número específico. Cacheado por
 * 5 minutos por phoneNumberId: é chamado a cada carregamento da fila/tela,
 * não vale bater na Meta toda hora. Falha na consulta nunca trava o envio
 * — cai pro limite do .env e mostra o phoneNumberId cru como último recurso.
 */
export async function getPhoneNumberInfo(phoneNumberId: string, accessToken: string): Promise<PhoneNumberStatus> {
  const cached = phoneStatusCache.get(phoneNumberId);
  if (cached && Date.now() - cached.fetchedAt < STATUS_CACHE_MS) {
    return cached.value;
  }

  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}`);
    url.searchParams.set("fields", "display_phone_number,verified_name,quality_rating,messaging_limit_tier");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = (await res.json().catch(() => ({}))) as {
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
      messaging_limit_tier?: string;
    };
    if (!res.ok) throw new Error("Falha ao consultar o número na Meta");

    const tier = payload.messaging_limit_tier ?? null;
    const value: PhoneNumberStatus = {
      qualityRating: payload.quality_rating ?? null,
      messagingLimitTier: tier,
      dailyLimit: (tier && TIER_LIMITS[tier]) || env.WHATSAPP_DAILY_LIMIT,
      displayPhoneNumber: payload.display_phone_number ?? null,
      verifiedName: payload.verified_name ?? null,
    };
    phoneStatusCache.set(phoneNumberId, { value, fetchedAt: Date.now() });
    return value;
  } catch (err) {
    console.error(`[WHATSAPP] Falha ao consultar número ${phoneNumberId} na Meta:`, (err as Error).message);
    return {
      qualityRating: null,
      messagingLimitTier: null,
      dailyLimit: env.WHATSAPP_DAILY_LIMIT,
      displayPhoneNumber: null,
      verifiedName: null,
    };
  }
}

/** Igual `getPhoneNumberInfo`, mas já resolve a credencial ativa — é o que a fila e o status geral usam. */
export async function getPhoneNumberStatus(): Promise<PhoneNumberStatus | null> {
  const credentials = await getActiveCredentials();
  if (!credentials) return null;
  return getPhoneNumberInfo(credentials.phoneNumberId, credentials.accessToken);
}

/**
 * Credenciais ativas: a conta conectada via Embedded Signup com `active:
 * true` tem prioridade sobre o .env — o .env só serve pra sandbox/dev antes
 * de qualquer conexão existir. Pode haver mais de uma conta conectada
 * (failover manual — ver `WhatsappAccount` no schema), mas só uma fica
 * ativa por vez; se por algum motivo nenhuma estiver marcada ativa, cai pra
 * mais recente em vez de ficar sem enviar nada.
 */
export async function getActiveCredentials(): Promise<WhatsappCredentials | null> {
  const account =
    (await prisma.whatsappAccount.findFirst({ where: { active: true }, orderBy: { connectedAt: "desc" } })) ??
    (await prisma.whatsappAccount.findFirst({ orderBy: { connectedAt: "desc" } }));
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

export async function listAccounts(): Promise<WhatsappAccountSummary[]> {
  const accounts = await prisma.whatsappAccount.findMany({ orderBy: { connectedAt: "desc" } });
  return Promise.all(
    accounts.map(async (account) => {
      const info = await getPhoneNumberInfo(account.phoneNumberId, account.accessToken);
      return {
        id: account.id,
        wabaId: account.wabaId,
        phoneNumberId: account.phoneNumberId,
        displayPhoneNumber: info.displayPhoneNumber,
        businessName: account.businessName,
        label: account.label,
        active: account.active,
        connectedAt: account.connectedAt,
      };
    })
  );
}

/** Apelido interno da equipe pra essa conta — não mexe em nada na Meta. */
export async function renameAccount(accountId: number, label: string | null, userId: number): Promise<void> {
  const account = await prisma.whatsappAccount.update({
    where: { id: accountId },
    data: { label: label?.trim() || null },
  });

  await recordAudit({
    userId,
    action: "whatsapp.renamed",
    entity: "WhatsappAccount",
    entityId: accountId,
    metadata: { label: account.label },
  });
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const account =
    (await prisma.whatsappAccount.findFirst({ where: { active: true }, orderBy: { connectedAt: "desc" } })) ??
    (await prisma.whatsappAccount.findFirst({ orderBy: { connectedAt: "desc" } }));
  const phoneStatus = await getPhoneNumberStatus();
  const dailyLimit = phoneStatus?.dailyLimit ?? env.WHATSAPP_DAILY_LIMIT;

  if (account) {
    return {
      connected: true,
      source: "signup",
      wabaId: account.wabaId,
      phoneNumberId: account.phoneNumberId,
      displayPhoneNumber: phoneStatus?.displayPhoneNumber ?? null,
      businessName: account.businessName ?? phoneStatus?.verifiedName ?? null,
      connectedAt: account.connectedAt,
      qualityRating: phoneStatus?.qualityRating ?? null,
      messagingLimitTier: phoneStatus?.messagingLimitTier ?? null,
      dailyLimit,
    };
  }
  if (env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      connected: true,
      source: "env",
      wabaId: null,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      displayPhoneNumber: phoneStatus?.displayPhoneNumber ?? null,
      businessName: phoneStatus?.verifiedName ?? null,
      connectedAt: null,
      qualityRating: phoneStatus?.qualityRating ?? null,
      messagingLimitTier: phoneStatus?.messagingLimitTier ?? null,
      dailyLimit,
    };
  }
  return {
    connected: false,
    source: null,
    wabaId: null,
    phoneNumberId: null,
    displayPhoneNumber: null,
    businessName: null,
    connectedAt: null,
    qualityRating: null,
    messagingLimitTier: null,
    dailyLimit: env.WHATSAPP_DAILY_LIMIT,
  };
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

/**
 * Adiciona uma conexão nova, sem mexer nas que já existem — é assim que o
 * failover de dois números funciona: conectar um segundo número não troca
 * qual está em uso, só fica disponível pra ativação manual depois (ver
 * `setActiveAccount`). Exceção: se for a primeira conta de todas, já entra
 * ativa (preserva o comportamento de sempre — conectar já habilita o
 * envio, sem passo extra).
 */
export async function saveConnection(input: SaveConnectionInput): Promise<void> {
  const isFirst = (await prisma.whatsappAccount.count()) === 0;

  await prisma.whatsappAccount.create({
    data: {
      clientId: requireActiveClientId(),
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      businessName: input.businessName,
      accessToken: input.accessToken,
      connectedById: input.connectedById,
      active: isFirst,
    },
  });

  await recordAudit({
    userId: input.connectedById,
    action: "whatsapp.connected",
    entity: "WhatsappAccount",
    metadata: { wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, businessName: input.businessName },
  });
}

/**
 * "Adota" o fallback do .env como uma conta de verdade na tabela — a
 * equipe pediu pra poder editar apelido e remover o número que hoje só
 * aparece como texto fixo (source: "env"), porque a credencial vive na
 * variável de ambiente, sem linha nenhuma pra editar/remover. Depois de
 * adotado, funciona igual a qualquer conta conectada via Embedded Signup
 * (mesmo token, então o envio nem percebe a troca) — inclusive dá pra
 * remover de novo depois, e aí volta a cair no fallback do .env como
 * antes (as variáveis continuam lá).
 */
export async function adoptEnvAccount(userId: number): Promise<void> {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("Não há credencial no .env pra adotar (falta WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID).");
  }
  if (!env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    throw new Error("Falta WHATSAPP_BUSINESS_ACCOUNT_ID no .env — é o WABA ID, necessário pra virar conta gerenciável.");
  }

  const existing = await prisma.whatsappAccount.findFirst({
    where: { phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID },
  });
  if (existing) return; // já foi adotado antes — idempotente, não duplica

  const isFirst = (await prisma.whatsappAccount.count()) === 0;

  const account = await prisma.whatsappAccount.create({
    data: {
      clientId: requireActiveClientId(),
      wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      connectedById: userId,
      active: isFirst,
    },
  });

  await recordAudit({
    userId,
    action: "whatsapp.adopted_env",
    entity: "WhatsappAccount",
    entityId: account.id,
    metadata: { wabaId: account.wabaId, phoneNumberId: account.phoneNumberId },
  });
}

/** Troca qual conta está ativa — é o botão de failover manual na tela. */
export async function setActiveAccount(accountId: number, userId: number): Promise<void> {
  const account = await prisma.whatsappAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Conta do WhatsApp não encontrada.");

  await prisma.$transaction([
    prisma.whatsappAccount.updateMany({ data: { active: false } }),
    prisma.whatsappAccount.update({ where: { id: accountId }, data: { active: true } }),
  ]);

  await recordAudit({
    userId,
    action: "whatsapp.activated",
    entity: "WhatsappAccount",
    entityId: accountId,
    metadata: { wabaId: account.wabaId, phoneNumberId: account.phoneNumberId },
  });
}

/**
 * Remove uma conta específica. Se era a ativa e sobrou alguma outra, promove
 * a mais recente automaticamente — nunca deixa o sistema sem nenhuma conta
 * ativa enquanto existir pelo menos uma conectada.
 */
export async function removeAccount(accountId: number, userId: number): Promise<void> {
  const account = await prisma.whatsappAccount.findUnique({ where: { id: accountId } });
  if (!account) return;

  await prisma.whatsappAccount.delete({ where: { id: accountId } });

  if (account.active) {
    const next = await prisma.whatsappAccount.findFirst({ orderBy: { connectedAt: "desc" } });
    if (next) await prisma.whatsappAccount.update({ where: { id: next.id }, data: { active: true } });
  }

  await recordAudit({
    userId,
    action: "whatsapp.disconnected",
    entity: "WhatsappAccount",
    entityId: accountId,
    metadata: { wabaId: account.wabaId, phoneNumberId: account.phoneNumberId },
  });
}
