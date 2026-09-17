import { describe, expect, it } from "vitest";
import {
  findClosestProcedureName,
  matchScheduleReference,
  parseScheduleReference,
  type ScheduleReferenceCandidate,
} from "./schedule-reference.js";

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

  it("também lê o procedimento (trecho ANTES do horário) — formato CISAMVE", () => {
    const text = "ULTRASSONOGRAFIA DE APARELHO URINÁRIO 19/09/2026 10:13:00 MARIA EXEMPLO SANTOS";
    const [row] = parseScheduleReference(text);
    expect(row?.procedure).toBe("ULTRASSONOGRAFIA DE APARELHO URINÁRIO");
    expect(row?.name).toBe("MARIA EXEMPLO SANTOS");
  });

  it("procedimento fica null quando não há nada reconhecível antes do horário (formato mais simples/antigo)", () => {
    const [row] = parseScheduleReference("13:49 GABRIELA EXEMPLO DA SILVA");
    expect(row?.procedure).toBeNull();
  });

  it("procedimento captura a qualificação entre parênteses (achado real: 'PÉLVICA (GINECOLÓGICA)')", () => {
    const text = "ULTRASSONOGRAFIA PÉLVICA (GINECOLÓGICA) 19/09/2026 15:41:00 MARIA EXEMPLO SILVA";
    const [row] = parseScheduleReference(text);
    expect(row?.procedure).toBe("ULTRASSONOGRAFIA PÉLVICA (GINECOLÓGICA)");
  });
});

describe("findClosestProcedureName", () => {
  it("casa grafia bem diferente entre fontes (CISAMVE × catálogo do sistema) — prefixo numérico, hífen e 'DE'/'DO' não devem impedir", () => {
    const catalogNames = ["01 - ULTRA-SONOGRAFIA DO APARELHO URINARIO", "01 - ULTRA-SONOGRAFIA DE TIREOIDE"];
    expect(findClosestProcedureName("ULTRASSONOGRAFIA DE APARELHO URINÁRIO", catalogNames)).toBe(
      "01 - ULTRA-SONOGRAFIA DO APARELHO URINARIO"
    );
  });

  it("não adivinha quando o procedimento não existe entre os candidatos (ex.: Doppler numa lista só de ultrassonografia)", () => {
    const catalogNames = ["01 - ULTRA-SONOGRAFIA DO APARELHO URINARIO", "01 - ULTRA-SONOGRAFIA DE TIREOIDE"];
    expect(findClosestProcedureName("DOPPLER COLORIDO DE CARÓTIDAS E VERTEBRAIS", catalogNames)).toBeNull();
  });
});

describe("matchScheduleReference", () => {
  const candidates: ScheduleReferenceCandidate[] = [
    { id: 1, name: "FLAVIA EXEMPLO MINKS", procedureName: "01 - ULTRA-SONOGRAFIA TRANSVAGINAL" },
    { id: 2, name: "FLAVIA EXEMPLO MINKS", procedureName: "01 - ULTRA-SONOGRAFIA DE MAMAS BILATERAL" },
    { id: 3, name: "MARIA EXEMPLO SANTOS", procedureName: "01 - ULTRA-SONOGRAFIA DO APARELHO URINARIO" },
  ];

  it("(a) paciente com 2 exames no mesmo dia — casa cada linha com o agendamento do procedimento certo, não o primeiro que achar", () => {
    const text = `ULTRASSONOGRAFIA TRANSVAGINAL 19/09/2026 08:00:00 FLAVIA EXEMPLO MINKS
ULTRASSONOGRAFIA MAMARIA BILATERAL 19/09/2026 13:42:00 FLAVIA EXEMPLO MINKS`;
    const rows = parseScheduleReference(text);
    const result = matchScheduleReference(rows, candidates);

    expect(result.unmatchedReference).toHaveLength(0);
    expect(result.matches).toHaveLength(2);
    const transvaginal = result.matches.find((m) => m.time === "08:00");
    const mamas = result.matches.find((m) => m.time === "13:42");
    expect(transvaginal?.candidateId).toBe(1);
    expect(mamas?.candidateId).toBe(2);
  });

  it("(b) linha de exame que não pertence a esta lista (Doppler) fica sem casar — não tenta casar por nome sozinho", () => {
    const text = `ULTRASSONOGRAFIA TRANSVAGINAL 19/09/2026 08:00:00 FLAVIA EXEMPLO MINKS
DOPPLER COLORIDO DE CARÓTIDAS E VERTEBRAIS 19/09/2026 09:00:00 JOAO EXEMPLO DOPPLER`;
    const rows = parseScheduleReference(text);
    const result = matchScheduleReference(rows, candidates);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.candidateId).toBe(1);
    expect(result.unmatchedReference).toHaveLength(1);
    expect(result.unmatchedReference[0]?.name).toBe("JOAO EXEMPLO DOPPLER");
  });

  it("(c) grafia divergente de nome E de procedimento casam via fuzzy, os dois ao mesmo tempo", () => {
    const text = "ULTRASSONOGRAFIA DE APARELHO URINÁRIO 19/09/2026 10:13:00 MARIA EXEMPLO SANTOZ";
    const rows = parseScheduleReference(text);
    const result = matchScheduleReference(rows, candidates);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.candidateId).toBe(3);
  });

  it("(d) PDF sem coluna de procedimento reconhecível (formato mais simples/antigo) continua casando só por nome", () => {
    const rows = parseScheduleReference("10:13 MARIA EXEMPLO SANTOS");
    expect(rows[0]?.procedure).toBeNull();

    // Candidato com procedimento totalmente diferente do que qualquer coisa
    // no texto — sem procedimento na linha, isso não pode impedir o casamento.
    const onlyCandidate: ScheduleReferenceCandidate[] = [
      { id: 9, name: "MARIA EXEMPLO SANTOS", procedureName: "01 - ULTRA-SONOGRAFIA DE TIREOIDE" },
    ];
    const result = matchScheduleReference(rows, onlyCandidate);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.candidateId).toBe(9);
  });
});
