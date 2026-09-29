import { prisma } from "@/lib/prisma.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";
import { AppError } from "@/middleware/errorHandler.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { parseDateOnly } from "@/lib/http.js";
import {
  computeBillingStatus,
  resolveBillingWindow,
  type BillingMode,
  type BillingSettings,
  type BillingStatus,
} from "./billing.js";

/*
  Service do limite comercial de mensagens (ver billing.ts pro núcleo puro).

  Lê/escreve os campos novos de AppSettings — mesma linha 1:1 por cliente já
  usada por settings.service.ts, mas por um caminho SEPARADO: estes campos só
  podem ser editados pelo super admin em /admin (PATCH /api/settings, aberto
  a qualquer usuário do cliente, nunca toca neles).

  Toda função aqui usa `requireActiveClientId()` — nunca recebe `clientId`
  como parâmetro — porque quem chama já abre o contexto certo antes: uma
  requisição normal (fila processando o cliente da sessão) ou
  `runWithClient(clientId, () => ...)` explícito no /admin, exatamente o
  mesmo padrão de `buildIndicators()`/`admin.routes.ts` (GET
  /api/admin/indicators). Nunca chamar isto direto dentro de
  `runAsSuperAdmin` sem esse `runWithClient` aninhado — sem ele, a contagem
  de `WhatsappMessage` (modelo isolado) sairia sem filtro de cliente
  nenhum, vazando o uso de um cliente pro outro.
*/

async function loadSettings(clientId: number): Promise<BillingSettings> {
  const row = await prisma.appSettings.findUnique({ where: { clientId } });
  if (!row) throw new AppError("Configurações do sistema não encontradas pra este cliente.", 500);
  return {
    billingMode: row.billingMode,
    messageLimit: row.messageLimit,
    periodStartDate: row.periodStartDate,
    periodLengthDays: row.periodLengthDays,
    creditsBalance: row.creditsBalance,
    creditsGrantedAt: row.creditsGrantedAt,
  };
}

async function countUsed(settings: BillingSettings, now: Date): Promise<number> {
  if (settings.billingMode === "JANELA") {
    const window = resolveBillingWindow(settings, now);
    if (!window) return 0; // configuração incompleta — computeBillingStatus() já não bloqueia nesse caso
    return prisma.whatsappMessage.count({
      where: {
        direction: "ENVIADA",
        wamid: { not: null },
        createdAt: { gte: window.windowStart, lt: window.windowEnd },
      },
    });
  }

  if (settings.billingMode === "CREDITOS") {
    // Sem `creditsGrantedAt` (nunca recebeu crédito nenhum) não há âncora
    // pra contar a partir de — 0, não "desde sempre" (contaria histórico
    // de antes da feature existir, de todos os clientes que só ganharem
    // billingMode: CREDITOS um dia sem nunca ter passado por
    // addClientCredits ainda).
    if (!settings.creditsGrantedAt) return 0;
    return prisma.whatsappMessage.count({
      where: { direction: "ENVIADA", wamid: { not: null }, createdAt: { gte: settings.creditsGrantedAt } },
    });
  }

  return 0;
}

/** Status de cobrança do cliente ativo no contexto atual. */
export async function getBillingStatus(): Promise<BillingStatus> {
  const clientId = requireActiveClientId();
  const settings = await loadSettings(clientId);
  const now = new Date();
  const used = settings.billingMode ? await countUsed(settings, now) : 0;
  return computeBillingStatus(settings, now, used);
}

export interface SetBillingInput {
  billingMode: BillingMode | null;
  // JANELA
  messageLimit?: number;
  /** "YYYY-MM-DD" — mesmo formato de `dateOnlySchema` (lib/http.ts). */
  periodStartDate?: string;
  periodLengthDays?: number;
  // CREDITOS — saldo inicial ao entrar nesse modo (topups depois passam por addClientCredits).
  creditsBalance?: number;
}

/**
 * Super admin configura (ou limpa) o limite comercial de um cliente.
 * `billingMode: null` remove qualquer limite (volta a "sem limite").
 */
export async function setClientBilling(input: SetBillingInput, userId: number | null): Promise<BillingStatus> {
  const clientId = requireActiveClientId();
  const before = await loadSettings(clientId);

  const data =
    input.billingMode === null
      ? {
          billingMode: null,
          messageLimit: null,
          periodStartDate: null,
          periodLengthDays: null,
          creditsBalance: null,
          creditsGrantedAt: null,
        }
      : input.billingMode === "JANELA"
        ? buildJanelaData(input)
        : input.billingMode === "CREDITOS"
          ? buildCreditosData(input)
          : (() => {
              throw new AppError("Modo de cobrança inválido.", 400);
            })();

  await prisma.appSettings.update({ where: { clientId }, data });
  await recordAudit({
    clientId,
    userId,
    action: "admin.edit_client_billing",
    entity: "Client",
    entityId: clientId,
    oldValue: JSON.stringify(before),
    newValue: JSON.stringify(data),
  });

  return getBillingStatus();
}

function buildJanelaData(input: SetBillingInput) {
  if (!input.messageLimit || input.messageLimit <= 0) {
    throw new AppError("Informe um limite de mensagens maior que zero.", 400);
  }
  if (!input.periodStartDate) throw new AppError("Informe a data de início da janela.", 400);
  if (!input.periodLengthDays || input.periodLengthDays <= 0) {
    throw new AppError("Informe a duração da janela em dias (maior que zero).", 400);
  }
  return {
    billingMode: "JANELA" as const,
    messageLimit: input.messageLimit,
    periodStartDate: parseDateOnly(input.periodStartDate),
    periodLengthDays: input.periodLengthDays,
    creditsBalance: null,
    creditsGrantedAt: null,
  };
}

function buildCreditosData(input: SetBillingInput) {
  if (input.creditsBalance == null || input.creditsBalance < 0) {
    throw new AppError("Informe um saldo de créditos válido (0 ou mais).", 400);
  }
  return {
    billingMode: "CREDITOS" as const,
    creditsBalance: input.creditsBalance,
    creditsGrantedAt: new Date(),
    messageLimit: null,
    periodStartDate: null,
    periodLengthDays: null,
  };
}

/**
 * Soma créditos ao saldo atual — preserva o que sobrou (calcula o restante
 * antes de somar) e reseta a âncora de contagem pra agora. Só vale pra
 * cliente já configurado em modo CREDITOS (trocar de modo é
 * `setClientBilling`).
 */
export async function addClientCredits(amount: number, userId: number | null): Promise<BillingStatus> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError("Informe uma quantidade de créditos maior que zero.", 400);
  }
  const clientId = requireActiveClientId();
  const before = await loadSettings(clientId);
  if (before.billingMode !== "CREDITOS") {
    throw new AppError("Esse cliente não está no modo de créditos.", 409);
  }

  const now = new Date();
  const used = await countUsed(before, now);
  const remaining = Math.max(0, (before.creditsBalance ?? 0) - used);
  const newBalance = remaining + amount;

  await prisma.appSettings.update({
    where: { clientId },
    data: { creditsBalance: newBalance, creditsGrantedAt: now },
  });
  await recordAudit({
    clientId,
    userId,
    action: "admin.add_client_credits",
    entity: "Client",
    entityId: clientId,
    metadata: { amount, remainingBefore: remaining, balanceBefore: before.creditsBalance, balanceAfter: newBalance },
  });

  return getBillingStatus();
}
