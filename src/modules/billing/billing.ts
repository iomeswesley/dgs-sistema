import { parseBrasiliaDateTime } from "@/lib/timezone.js";

/*
  Limite comercial de mensagens por cliente (2026-09-28).

  Módulo puro — sem banco — porque é a regra que decide se a fila pode
  mandar mensagem de verdade pra um cliente ou não, e errar aqui significa
  ou bloquear cliente em dia (perde confirmação de paciente de verdade) ou
  deixar de bloquear quem já passou do combinado (a DGS manda WhatsApp de
  graça). Contagem em si (quantas mensagens já saíram) é responsabilidade
  do service — este módulo só recebe o número já contado.

  Dois modos, mutuamente exclusivos por cliente (`AppSettings.billingMode`):
    - JANELA: teto de mensagens dentro de um intervalo de N dias que se
      repete sozinho a partir de `periodStartDate` (7 dias pra teste, 30
      pra mensalidade, etc. — qualquer valor, é o admin quem escolhe).
    - CREDITOS: saldo que só é reposto manualmente (`addClientCredits`),
      nunca reseta por tempo.
  `billingMode: null` = sem limite nenhum (comportamento de todo cliente
  antes desta feature existir, e o que qualquer cliente sem billing
  configurado continua tendo).
*/

export type BillingMode = "JANELA" | "CREDITOS";

/** Espelha os campos novos de `AppSettings` — o service lê do banco e monta isto. */
export interface BillingSettings {
  billingMode: BillingMode | null;
  messageLimit: number | null;
  /** Coluna `@db.Date` — data de calendário pura, ver nota abaixo. */
  periodStartDate: Date | null;
  periodLengthDays: number | null;
  creditsBalance: number | null;
  creditsGrantedAt: Date | null;
}

export interface BillingWindow {
  /** Timestamp real (meia-noite de Brasília do dia em que a janela atual começa). */
  windowStart: Date;
  /** Timestamp real, exclusivo (início da próxima janela). */
  windowEnd: Date;
}

export interface BillingStatus {
  mode: BillingMode | null;
  blocked: boolean;
  /** Teto (JANELA) ou saldo concedido (CREDITOS) — `null` quando incompleto/sem limite. */
  limit: number | null;
  used: number;
  /** `null` quando não há limite pra calcular contra. */
  remaining: number | null;
  /** Fim da janela atual (JANELA) — `null` pra CREDITOS (não reseta sozinho) ou sem limite. */
  resetsAt: Date | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * "YYYY-MM-DD" de uma coluna `@db.Date` — ler os componentes UTC direto,
 * nunca formatar com `timeZone` (essa é a semântica de timestamp real,
 * não de data de calendário — ver CLAUDE.md, bugs de 2026-08-25/26).
 * Mesmo padrão de `agendaDateString()`/`closingDateKey()` já usados no
 * projeto (cancellations.service.ts, closings.service.ts).
 */
function calendarDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * Em qual janela `now` cai, a partir de `periodStartDate`/`periodLengthDays`.
 * `null` quando o modo não é JANELA ou a configuração está incompleta.
 *
 * Índice de janela clampado em 0: se `periodStartDate` for uma data futura,
 * a janela "atual" é a primeira (ainda não começou) — não há mensagem com
 * `createdAt` antes dela mesmo, então isso nunca conta uso indevido, só
 * evita um índice negativo sem sentido.
 */
export function resolveBillingWindow(settings: BillingSettings, now: Date): BillingWindow | null {
  if (settings.billingMode !== "JANELA") return null;
  if (!settings.periodStartDate || !settings.periodLengthDays || settings.periodLengthDays <= 0) return null;

  const start = parseBrasiliaDateTime(`${calendarDateString(settings.periodStartDate)}T00:00:00.000`);
  const lengthMs = settings.periodLengthDays * MS_PER_DAY;

  const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / MS_PER_DAY);
  const windowIndex = Math.max(0, Math.floor(daysSinceStart / settings.periodLengthDays));

  const windowStart = new Date(start.getTime() + windowIndex * lengthMs);
  const windowEnd = new Date(windowStart.getTime() + lengthMs);
  return { windowStart, windowEnd };
}

/**
 * Status de cobrança já resolvido, dado `used` (contagem que o service já
 * fez, escopada à janela atual ou a partir de `creditsGrantedAt`, conforme
 * o modo). Nunca bloqueia com configuração incompleta (falta de
 * `messageLimit`/`creditsBalance`) — evita bloqueio acidental por cadastro
 * pela metade.
 */
export function computeBillingStatus(settings: BillingSettings, now: Date, used: number): BillingStatus {
  if (settings.billingMode === "JANELA") {
    const window = resolveBillingWindow(settings, now);
    const limit = settings.messageLimit ?? null;
    const remaining = limit == null ? null : Math.max(0, limit - used);
    return {
      mode: "JANELA",
      blocked: limit != null && used >= limit,
      limit,
      used,
      remaining,
      resetsAt: window?.windowEnd ?? null,
    };
  }

  if (settings.billingMode === "CREDITOS") {
    const limit = settings.creditsBalance ?? null;
    const remaining = limit == null ? null : Math.max(0, limit - used);
    return {
      mode: "CREDITOS",
      blocked: limit != null && remaining !== null && remaining <= 0,
      limit,
      used,
      remaining,
      resetsAt: null,
    };
  }

  return { mode: null, blocked: false, limit: null, used: 0, remaining: null, resetsAt: null };
}
