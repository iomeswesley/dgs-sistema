import { describe, expect, it } from "vitest";
import {
  estimateAttendanceRate,
  FALLBACK_ATTENDANCE_RATE,
  noShowScore,
  suggestConfirmations,
} from "@/modules/suggestions/suggestions.js";

describe("estimateAttendanceRate", () => {
  it("prefere o recorte mais específico quando a amostra basta", () => {
    const estimate = estimateAttendanceRate({
      doctorProcedure: { confirmed: 100, attended: 70 },
      doctor: { confirmed: 500, attended: 450 },
      global: { confirmed: 5000, attended: 4000 },
    });
    expect(estimate.basis).toBe("doctor_procedure");
    expect(estimate.rate).toBeCloseTo(0.7);
  });

  it("desce na cascata quando o recorte específico tem amostra pequena", () => {
    const estimate = estimateAttendanceRate({
      doctorProcedure: { confirmed: 5, attended: 1 }, // amostra insuficiente
      doctor: { confirmed: 200, attended: 160 },
    });
    expect(estimate.basis).toBe("doctor");
    expect(estimate.rate).toBeCloseTo(0.8);
  });

  it("cai no padrão quando não há histórico nenhum", () => {
    const estimate = estimateAttendanceRate({});
    expect(estimate.basis).toBe("fallback");
    expect(estimate.rate).toBe(FALLBACK_ATTENDANCE_RATE);
    expect(estimate.sampleSize).toBe(0);
  });

  it("limita a taxa a 1 quando o fechamento inclui encaixes", () => {
    // 30 atendidos para 25 confirmados: 5 eram encaixe, não da lista.
    const estimate = estimateAttendanceRate({ doctor: { confirmed: 25, attended: 30 } });
    expect(estimate.rate).toBe(1);
  });

  it("ignora recorte com taxa zero em vez de sugerir infinito", () => {
    const estimate = estimateAttendanceRate({
      doctorProcedure: { confirmed: 40, attended: 0 },
      doctor: { confirmed: 100, attended: 75 },
    });
    expect(estimate.basis).toBe("doctor");
  });
});

describe("suggestConfirmations", () => {
  it("calcula o overbooking a partir da taxa histórica", () => {
    // O exemplo do PLANO.md: 20 esperados, taxa de 78% → ~26 confirmações.
    const suggestion = suggestConfirmations({
      expectedPerDay: 20,
      confirmationsSoFar: 0,
      estimate: { rate: 0.78, basis: "doctor", sampleSize: 120 },
    });
    expect(suggestion.confirmationsNeeded).toBe(26);
    expect(suggestion.stillNeeded).toBe(26);
    expect(suggestion.explanation).toContain("busque ~26 confirmações");
  });

  it("desconta o que já foi confirmado", () => {
    const suggestion = suggestConfirmations({
      expectedPerDay: 20,
      confirmationsSoFar: 18,
      estimate: { rate: 0.78, basis: "doctor", sampleSize: 120 },
    });
    expect(suggestion.stillNeeded).toBe(8);
  });

  it("não pede mais nada quando a agenda já está coberta", () => {
    const suggestion = suggestConfirmations({
      expectedPerDay: 20,
      confirmationsSoFar: 30,
      estimate: { rate: 0.78, basis: "doctor", sampleSize: 120 },
    });
    expect(suggestion.stillNeeded).toBe(0);
    expect(suggestion.explanation).toContain("Agenda coberta");
  });

  it("avisa quando está chutando por falta de histórico", () => {
    const suggestion = suggestConfirmations({
      expectedPerDay: 10,
      confirmationsSoFar: 0,
      estimate: { rate: FALLBACK_ATTENDANCE_RATE, basis: "fallback", sampleSize: 0 },
    });
    expect(suggestion.explanation).toContain("sem histórico suficiente");
    expect(suggestion.confirmationsNeeded).toBe(13);
  });

  it("com comparecimento perfeito, sugere exatamente a capacidade", () => {
    const suggestion = suggestConfirmations({
      expectedPerDay: 20,
      confirmationsSoFar: 0,
      estimate: { rate: 1, basis: "doctor", sampleSize: 50 },
    });
    expect(suggestion.confirmationsNeeded).toBe(20);
  });
});

describe("noShowScore", () => {
  it("não classifica quem tem pouco histórico", () => {
    expect(noShowScore({ confirmedCount: 2, attendedCount: 0, noShowCount: 2 })).toMatchObject({
      label: "sem histórico",
      reliable: false,
      risk: 0,
    });
  });

  it("marca quem falta muito", () => {
    const score = noShowScore({ confirmedCount: 6, attendedCount: 2, noShowCount: 4 });
    expect(score.label).toBe("falta muito");
    expect(score.risk).toBeCloseTo(0.667, 2);
    expect(score.reliable).toBe(true);
  });

  it("marca atenção na faixa intermediária", () => {
    expect(noShowScore({ confirmedCount: 8, attendedCount: 6, noShowCount: 2 }).label).toBe("atenção");
  });

  it("reconhece quem sempre comparece", () => {
    expect(noShowScore({ confirmedCount: 10, attendedCount: 10, noShowCount: 0 })).toMatchObject({
      label: "comparece",
      risk: 0,
    });
  });
});
