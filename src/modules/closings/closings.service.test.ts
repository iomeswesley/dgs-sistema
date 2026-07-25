import { describe, expect, it } from "vitest";
import { buildAlerts } from "@/modules/closings/closings.alerts.js";

function row(overrides: Partial<Parameters<typeof buildAlerts>[0]> = {}) {
  return {
    planned: 20,
    confirmed: 15,
    attendedReported: null,
    paidCount: null,
    extrasCount: 0,
    ...overrides,
  };
}

describe("buildAlerts — nada lançado ainda", () => {
  it("não alerta enquanto os checks 2 e 3 estão vazios", () => {
    expect(buildAlerts(row())).toEqual([]);
  });

  it("não alerta quando só os atendidos foram lançados e fecham", () => {
    expect(buildAlerts(row({ attendedReported: 14 }))).toEqual([]);
  });
});

describe("buildAlerts — check 2 (atendidos)", () => {
  it("acusa atendidos acima dos confirmados sem encaixe lançado", () => {
    const alerts = buildAlerts(row({ confirmed: 15, attendedReported: 18 }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("Faltou lançar encaixe?");
  });

  it("aceita atendidos acima dos confirmados quando o encaixe explica", () => {
    // Caso comum: 15 confirmados, 3 encaixes que não estavam na lista.
    expect(buildAlerts(row({ confirmed: 15, attendedReported: 18, extrasCount: 3 }))).toEqual([]);
  });

  it("acusa atendidos acima do total da lista mesmo com encaixe", () => {
    const alerts = buildAlerts(row({ planned: 20, confirmed: 15, attendedReported: 30, extrasCount: 3 }));
    expect(alerts.some((alert) => alert.includes("acima do total da lista"))).toBe(true);
  });
});

describe("buildAlerts — check 3 (guias)", () => {
  it("acusa guias acima do que o médico informou", () => {
    const alerts = buildAlerts(row({ attendedReported: 14, paidCount: 16 }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("Guias (16) acima");
  });

  it("aceita divergência pequena sem alarmar", () => {
    // 14 atendidos, 13 guias = 7% — dentro do esperado.
    expect(buildAlerts(row({ attendedReported: 14, paidCount: 13 }))).toEqual([]);
  });

  it("acusa divergência acima de 10%", () => {
    // Atendidos igual aos confirmados de propósito: assim o único alerta
    // possível é o da divergência com as guias.
    const alerts = buildAlerts(row({ confirmed: 20, attendedReported: 20, paidCount: 15 }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("Divergência de 25%");
  });

  it("não divide por zero quando o médico informou zero atendimentos", () => {
    expect(buildAlerts(row({ attendedReported: 0, paidCount: 0 }))).toEqual([]);
  });

  it("não alerta se só as guias foram lançadas", () => {
    expect(buildAlerts(row({ paidCount: 12 }))).toEqual([]);
  });
});
