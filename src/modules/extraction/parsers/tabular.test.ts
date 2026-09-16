import { describe, expect, it } from "vitest";
import { parseTabular } from "./tabular.js";

// Fixture sintética (dados fictícios), com a estrutura exata do texto que
// o pdf-parse devolve pro formato achado em 2026-09-16 (lista de
// Botuverá): cabeçalho de coluna, uma linha por paciente, telefone em
// formatos variados (formatado com hífen, cru com espaço em vez de hífen,
// 8 dígitos sem o nono), e um horário sem paciente nenhum (vaga vazia).
const TABULAR_TEXT = `SISREG Nome Data nasc. Telefone Procedimento Data Horário Observação
111111111 MARIA EXEMPLO SOUZA 21/04/1974 (47) 99606-8274 CONSULTA EM ORTOPEDIA - GERAL 17/09/2026 07:00
222222222 JOSE EXEMPLO KUSSNER 04/03/1997 47 9840 05251 CONSULTA EM ORTOPEDIA - GERAL 17/09/2026 07:15
CONSULTA EM ORTOPEDIA - GERAL 17/09/2026 07:25
333333333 ANA EXEMPLO PEREIRA 27/06/1969 (47) 8401-8065 CONSULTA EM ORTOPEDIA - GERAL 17/09/2026 07:30`;

describe("parseTabular", () => {
  it("marca o sourceFormat e não acha dado de cabeçalho (não existe no arquivo)", () => {
    const result = parseTabular(TABULAR_TEXT);
    expect(result.sourceFormat).toBe("TABULAR");
    expect(result.municipality).toBeNull();
    expect(result.executingUnit).toBeNull();
    expect(result.doctor).toBeNull();
  });

  it("extrai uma linha por paciente, ignorando o cabeçalho da coluna e a vaga sem paciente", () => {
    const result = parseTabular(TABULAR_TEXT);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.name)).toEqual([
      "MARIA EXEMPLO SOUZA",
      "JOSE EXEMPLO KUSSNER",
      "ANA EXEMPLO PEREIRA",
    ]);
  });

  it("lê nascimento, telefone e procedimento de cada linha", () => {
    const [first] = parseTabular(TABULAR_TEXT).rows;
    expect(first?.birthDate).toBe("1974-04-21");
    expect(first?.phones).toEqual(["(47) 99606-8274"]);
    expect(first?.procedure).toBe("CONSULTA EM ORTOPEDIA - GERAL");
    expect(first?.scheduledAt).toBe("2026-09-17T07:00");
  });

  it("guarda telefone com dígitos separados por espaço (sem hífen) como veio — normalizePhone() limpa depois", () => {
    const [, second] = parseTabular(TABULAR_TEXT).rows;
    expect(second?.phones).toEqual(["47 9840 05251"]);
  });

  it("nunca lê médico — não existe no formato, quem sobe a lista escolhe", () => {
    for (const row of parseTabular(TABULAR_TEXT).rows) {
      expect(row.doctor).toBeNull();
    }
  });

  it("avisa quando nenhuma linha de paciente é reconhecida", () => {
    const result = parseTabular("SISREG Nome Data nasc. Telefone Procedimento Data Horário Observação");
    expect(result.rows).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/nenhuma linha de paciente reconhecida/i);
  });
});
