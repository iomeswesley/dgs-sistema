import { describe, expect, it } from "vitest";
import { parseScheduleReference } from "./schedule-reference.js";

describe("parseScheduleReference", () => {
  it("lê nome e horário de linhas com formato variado (fictício)", () => {
    const text = `CONSULTA EM CARDIOLOGIA 17/09/2026 07:00:00 MARIA EXEMPLO DA SILVA
CONSULTA EM CARDIOLOGIA 17/09/2026 07:15:00 JOSE EXEMPLO PEREIRA`;
    const rows = parseScheduleReference(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ time: "07:00", name: "MARIA EXEMPLO DA SILVA" });
    expect(rows[1]).toMatchObject({ time: "07:15", name: "JOSE EXEMPLO PEREIRA" });
  });

  it("ignora linha sem horário ou sem nome composto", () => {
    const text = `Cabeçalho qualquer sem hora nenhuma
07:00 A
Descrição do exame`;
    expect(parseScheduleReference(text)).toHaveLength(0);
  });

  it("prioriza o nome DEPOIS do horário, não a descrição do exame antes dele (mesmo sendo mais longa)", () => {
    const text = `ULTRA-SONOGRAFIA DE ABDOMEN SUPERIOR COMPLETO 17/09/2026 08:24:00 ELSITA SANTOS`;
    const rows = parseScheduleReference(text);
    expect(rows[0]?.name).toBe("ELSITA SANTOS");
  });

  it("aceita horário sem segundos", () => {
    const rows = parseScheduleReference("13:49 GABRIELA EXEMPLO DA SILVA");
    expect(rows[0]?.time).toBe("13:49");
  });
});
