import { describe, expect, it } from "vitest";
import { detectFormat } from "./detect.js";
import { parseIds } from "./ids.js";

// Mesma estrutura do texto que o pdf-parse tira do relatório real do IDS
// Saúde (Ascurra, 2026-10-16) — nomes e telefones fictícios.
const HEADER = `C.N.P.J.: 83.102.772/0001-61 Página: 1 de 2
Data: 16/10/2026
Horário: 08:26:13
Município de Ascurra
Agendamento de Consulta
Situação = Agendado
Profissional = 1877
Data entre 19/10/2026 e 20/10/2026
Agrupamento = Unidade de Saúde de Atendimento e Data e Horário e Usuário
Telefone Tel.Celular Tel.Contato`;
const FOOTER = `IDS Desenvolvimento de Software & Assessoria Ltda - IDS Saúde 7.26.1.374 Programa: TDmAgeCon5181 - Modelo.fr3`;

const SAMPLE = `${HEADER}
3 - UNIDADE INTEGRADA DE SAUDE
19/10/2026
08:00:00
111 - FULANA DE TESTE
(99)99999-9999 (99)99999-9999
08:20:00
222 - BELTRANO SILVA
(47)3333-0000 (47)99999-0001 (47)3333-0000
08:40:00
${FOOTER}

-- 1 of 2 --

${HEADER.replace("Página: 1", "Página: 2")}
333 - CICLANA SOUZA
(47)99999-0002 (47)99999-0002 (47)99999-0003
20/10/2026
13:00:00
444 - JOANA PEREIRA
(47)98888-0004
${FOOTER}

-- 2 of 2 --`;

describe("parseIds", () => {
  it("é reconhecido pelo rodapé do IDS Saúde", () => {
    expect(detectFormat(SAMPLE)).toBe("IDS");
  });

  const result = parseIds(SAMPLE);

  it("lê cabeçalho e separa a linha da unidade dos pacientes", () => {
    expect(result.sourceFormat).toBe("IDS");
    expect(result.municipality).toBe("Ascurra");
    expect(result.executingUnit).toBe("UNIDADE INTEGRADA DE SAUDE");
    expect(result.rows.map((row) => row.name)).toEqual([
      "FULANA DE TESTE",
      "BELTRANO SILVA",
      "CICLANA SOUZA",
      "JOANA PEREIRA",
    ]);
  });

  it("dá a cada paciente a data e o horário do seu grupo, mesmo com quebra de página no meio", () => {
    expect(result.rows.map((row) => row.scheduledAt)).toEqual([
      "2026-10-19T08:00",
      "2026-10-19T08:20",
      "2026-10-19T08:40",
      "2026-10-20T13:00",
    ]);
  });

  it("junta os telefones sem repetir e descarta o placeholder (99)99999-9999", () => {
    expect(result.rows[0]!.phones).toEqual([]);
    expect(result.rows[1]!.phones).toEqual(["(47)3333-0000", "(47)99999-0001"]);
    expect(result.rows[2]!.phones).toEqual(["(47)99999-0002", "(47)99999-0003"]);
  });

  it("nunca usa a data/hora de emissão do relatório como atendimento", () => {
    expect(result.rows.some((row) => row.scheduledAt?.startsWith("2026-10-16"))).toBe(false);
  });

  it("avisa quando o arquivo traz mais de um dia", () => {
    expect(result.warnings.some((w) => w.includes("2 dias"))).toBe(true);
    expect(result.unrecognized).toEqual([]);
  });
});
