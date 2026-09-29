import { describe, expect, it } from "vitest";
import {
  computeBillingStatus,
  resolveBillingWindow,
  type BillingSettings,
} from "@/modules/billing/billing.js";

const base: BillingSettings = {
  billingMode: null,
  messageLimit: null,
  periodStartDate: null,
  periodLengthDays: null,
  creditsBalance: null,
  creditsGrantedAt: null,
};

// Datas de calendário puras, como viriam de uma coluna @db.Date (componentes
// UTC, sem hora) — mesmo formato que `parseDateOnly()` já produz.
function calendarDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

describe("resolveBillingWindow", () => {
  it("null quando billingMode não é JANELA", () => {
    expect(resolveBillingWindow({ ...base, billingMode: "CREDITOS" }, new Date())).toBeNull();
  });

  it("null com configuração incompleta (sem periodLengthDays)", () => {
    expect(
      resolveBillingWindow({ ...base, billingMode: "JANELA", periodStartDate: calendarDate(2026, 9, 1) }, new Date())
    ).toBeNull();
  });

  it("primeira janela cobre [inicio, inicio+duracao)", () => {
    const settings: BillingSettings = {
      ...base,
      billingMode: "JANELA",
      periodStartDate: calendarDate(2026, 9, 1),
      periodLengthDays: 30,
    };
    // 10 dias depois do início — ainda na primeira janela.
    const now = new Date("2026-09-11T12:00:00-03:00");
    const window = resolveBillingWindow(settings, now);
    expect(window).not.toBeNull();
    expect(window!.windowStart.toISOString()).toBe("2026-09-01T03:00:00.000Z"); // 00:00 Brasília
    expect(window!.windowEnd.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });

  it("vira pra janela seguinte sozinha, sem precisar de nenhuma ação manual", () => {
    const settings: BillingSettings = {
      ...base,
      billingMode: "JANELA",
      periodStartDate: calendarDate(2026, 9, 1),
      periodLengthDays: 30,
    };
    const now = new Date("2026-10-05T12:00:00-03:00"); // 34 dias depois do início
    const window = resolveBillingWindow(settings, now);
    expect(window!.windowStart.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(window!.windowEnd.toISOString()).toBe("2026-10-31T03:00:00.000Z");
  });

  it("data de início no futuro cai na primeira janela (índice nunca negativo)", () => {
    const settings: BillingSettings = {
      ...base,
      billingMode: "JANELA",
      periodStartDate: calendarDate(2026, 12, 1),
      periodLengthDays: 7,
    };
    const now = new Date("2026-09-28T12:00:00-03:00");
    const window = resolveBillingWindow(settings, now);
    expect(window!.windowStart.toISOString()).toBe("2026-12-01T03:00:00.000Z");
  });
});

describe("computeBillingStatus", () => {
  it("sem billingMode nunca bloqueia", () => {
    const status = computeBillingStatus(base, new Date(), 999);
    expect(status.mode).toBeNull();
    expect(status.blocked).toBe(false);
    expect(status.remaining).toBeNull();
  });

  it("JANELA: bloqueia só quando used >= limit", () => {
    const settings: BillingSettings = {
      ...base,
      billingMode: "JANELA",
      messageLimit: 1000,
      periodStartDate: calendarDate(2026, 9, 1),
      periodLengthDays: 30,
    };
    const now = new Date("2026-09-15T12:00:00-03:00");

    expect(computeBillingStatus(settings, now, 999).blocked).toBe(false);
    expect(computeBillingStatus(settings, now, 1000).blocked).toBe(true);
    expect(computeBillingStatus(settings, now, 1000).remaining).toBe(0);
    expect(computeBillingStatus(settings, now, 400).remaining).toBe(600);
  });

  it("JANELA sem messageLimit configurado não bloqueia (config incompleta)", () => {
    const settings: BillingSettings = {
      ...base,
      billingMode: "JANELA",
      periodStartDate: calendarDate(2026, 9, 1),
      periodLengthDays: 30,
    };
    expect(computeBillingStatus(settings, new Date("2026-09-15T12:00:00-03:00"), 5000).blocked).toBe(false);
  });

  it("CREDITOS: bloqueia quando o saldo acaba", () => {
    const settings: BillingSettings = { ...base, billingMode: "CREDITOS", creditsBalance: 500, creditsGrantedAt: new Date("2026-09-01T00:00:00Z") };
    const now = new Date("2026-09-20T00:00:00Z");

    expect(computeBillingStatus(settings, now, 499).blocked).toBe(false);
    expect(computeBillingStatus(settings, now, 500).blocked).toBe(true);
    expect(computeBillingStatus(settings, now, 700).remaining).toBe(0); // nunca negativo
  });

  it("CREDITOS nunca reseta sozinho por tempo (sem resetsAt)", () => {
    const settings: BillingSettings = { ...base, billingMode: "CREDITOS", creditsBalance: 100, creditsGrantedAt: new Date() };
    expect(computeBillingStatus(settings, new Date(), 10).resetsAt).toBeNull();
  });
});
