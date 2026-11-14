import { describe, expect, it } from "vitest";
import {
  doctorGreetingName,
  formatAgendaDate,
  isMorningWindow,
  summarizeProcedures,
  tomorrowCalendarDate,
} from "./doctor-notice.js";

describe("aviso de agenda ao médico", () => {
  it("só sai na janela da manhã de Brasília (7h–12h)", () => {
    expect(isMorningWindow(new Date("2026-11-14T09:59:00Z"))).toBe(false); // 06:59 BRT
    expect(isMorningWindow(new Date("2026-11-14T10:00:00Z"))).toBe(true); // 07:00 BRT
    expect(isMorningWindow(new Date("2026-11-14T14:59:00Z"))).toBe(true); // 11:59 BRT
    expect(isMorningWindow(new Date("2026-11-14T15:00:00Z"))).toBe(false); // 12:00 BRT
    expect(isMorningWindow(new Date("2026-11-14T19:00:00Z"))).toBe(false); // 16:00 BRT (outro cron)
  });

  it("amanhã é calculado em Brasília, mesmo quando em UTC já virou o dia", () => {
    // 22:30 de sábado 14/11 em Brasília = 01:30 de domingo 15/11 em UTC.
    expect(tomorrowCalendarDate(new Date("2026-11-15T01:30:00Z")).toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(tomorrowCalendarDate(new Date("2026-11-14T10:00:00Z")).toISOString()).toBe("2026-11-15T00:00:00.000Z");
    // Virada de mês.
    expect(tomorrowCalendarDate(new Date("2026-11-30T12:00:00Z")).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("data da agenda com dia da semana, sem perder um dia por fuso", () => {
    expect(formatAgendaDate(new Date("2026-11-16T00:00:00Z"))).toBe("segunda-feira, 16/11/2026");
  });

  it("nome com tratamento do cadastro", () => {
    expect(doctorGreetingName({ name: "Luiz Felipe", title: "Dr." })).toBe("Dr. Luiz Felipe");
    expect(doctorGreetingName({ name: "Ana Souza", title: "Dra." })).toBe("Dra. Ana Souza");
    expect(doctorGreetingName({ name: " Ana Souza ", title: null })).toBe("Ana Souza");
  });

  it("procedimentos da agenda sem procedimento definido", () => {
    expect(summarizeProcedures([])).toBe("conforme a agenda");
    expect(summarizeProcedures(["Não informado"])).toBe("conforme a agenda");
    expect(summarizeProcedures(["US Mama", "US Mama", "US Tireoide"])).toBe("US Mama, US Tireoide");
    expect(summarizeProcedures(["A", "B", "C", "D", "E"])).toBe("A, B e mais 3");
  });
});
