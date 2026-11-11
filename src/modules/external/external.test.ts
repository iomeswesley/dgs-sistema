import { describe, expect, it } from "vitest";
import { countSituacoes, daySpan, groupByAgenda } from "./external.js";

describe("countSituacoes", () => {
  it("separa confirmados, aguardando e precisa de ação, e calcula a taxa sem pendentes/cancelados", () => {
    const c = countSituacoes([
      "CONFIRMADO",
      "CONFIRMADO",
      "RECUSADO",
      "ENTREGUE",
      "PENDENTE",
      "FALHA",
      "SEM_TELEFONE",
      "SEM_RESPOSTA",
      "CANCELADO",
    ]);
    expect(c.total).toBe(9);
    expect(c.confirmados).toBe(2);
    expect(c.recusados).toBe(1);
    expect(c.aguardando).toBe(2);
    expect(c.precisaDeAcao).toBe(3);
    expect(c.cancelados).toBe(1);
    // base = 9 - 1 cancelado - 1 pendente = 7 → 2/7 = 28,6%
    expect(c.taxaConfirmacaoPercent).toBe(28.6);
  });

  it("taxa é null quando ninguém foi tentado ainda", () => {
    expect(countSituacoes(["PENDENTE", "PENDENTE"]).taxaConfirmacaoPercent).toBeNull();
    expect(countSituacoes([]).taxaConfirmacaoPercent).toBeNull();
  });
});

describe("groupByAgenda", () => {
  it("agrupa por dia + município + médico e ordena", () => {
    const g = groupByAgenda([
      { dia: "2026-11-12", municipio: "Pomerode", medico: "Dr. B", unidade: "Policlínica", status: "CONFIRMADO" },
      { dia: "2026-11-11", municipio: "Timbó", medico: "Dr. A", unidade: null, status: "RECUSADO" },
      { dia: "2026-11-12", municipio: "Pomerode", medico: "Dr. B", unidade: "Policlínica", status: "ENTREGUE" },
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ dia: "2026-11-11", municipio: "Timbó", total: 1, recusados: 1 });
    expect(g[1]).toMatchObject({ dia: "2026-11-12", medico: "Dr. B", total: 2, confirmados: 1, aguardando: 1 });
  });
});

describe("daySpan", () => {
  it("conta os dias inclusive", () => {
    expect(daySpan("2026-11-01", "2026-11-01")).toBe(1);
    expect(daySpan("2026-10-30", "2026-11-02")).toBe(4);
  });
});
