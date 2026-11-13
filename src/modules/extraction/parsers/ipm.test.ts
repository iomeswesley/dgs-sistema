import { describe, expect, it } from "vitest";
import { detectFormat } from "./detect.js";
import { parseIpm, splitPhones } from "./ipm.js";
import { mapExtraction } from "../extraction.mapper.js";

// Mesma estrutura do relatório real "Relação da Agenda para Contato" do
// Atende.Net (Camboriú, 2026-11-13) — nomes e telefones fictícios.
const SAMPLE = `FUNDO MUNICIPAL DE SAÚDE DE CAMBORIÚ
Regulação
Relação da Agenda para Contato
Estabelecimento Público: 10 Especialidade: 57 Profissional Saúde: 17369 Período Inicial: 16/11/2026 Período Final: 16/11/2026 Convênio: 47
Pág 1 /\t2
IPM Sistemas Ltda
Atende.Net - SRG v:2018.01
Identificador: SRG032201-72157-XXXX-0 - Emitido por: FULANA 13/11/2026 15:18:25 -03:00
Unidade Executante: POLICLINICA MUNICIPAL
Especialidade: Psiquiatra / Profissional: MEDICO DE TESTE
PACIENTE Idade Telefone Telefone 2 Telefone 3 Celular Data e Hora Convênio Situação
FULANA DE TESTE 42 47991110001 (47) 99111-0001 16/11/2026 08:00 SUS Agendado
BELTRANA D'AVILA 52 (47) 3363-0000, (47)
99111-0002, (47)
99111-0003
16/11/2026 08:00 SUS Agendado
CICLANO SILVA 38 47991110004 (47) 9111-0005 4791110006 16/11/2026 08:15 SUS Agendado
DEOCLECIO SOUZA 46 (47)99111-0007 (47)91110-007 16/11/2026 13:00 SUS Agendado
ERNESTINA ROSA 75 (99)99999-9999 16/11/2026 13:00 SUS Cancelado
FABIO SEM TELEFONE 30 16/11/2026 13:30 SUS Agendado
GERALDA PAGINA 61 (47) 99111-0008, (47)
-- 1 of 2 --
FUNDO MUNICIPAL DE SAÚDE DE CAMBORIÚ
Regulação
Relação da Agenda para Contato
Pág 2 /\t2
PACIENTE Idade Telefone Telefone 2 Telefone 3 Celular Data e Hora Convênio Situação
99111-0009
16/11/2026 13:45 SUS Agendado
Quantidade de agendamentos por procedimento: 7
Quantidade total de agendamentos: 7
IPM Sistemas Ltda

-- 2 of 2 --`;

describe("parseIpm", () => {
  it("é reconhecido pelo rodapé do IPM + título do relatório", () => {
    expect(detectFormat(SAMPLE)).toBe("IPM");
  });

  const result = parseIpm(SAMPLE);

  it("lê cabeçalho: município, unidade, médico e especialidade", () => {
    expect(result.sourceFormat).toBe("IPM");
    expect(result.municipality).toBe("CAMBORIÚ");
    expect(result.executingUnit).toBe("POLICLINICA MUNICIPAL");
    expect(result.doctor).toBe("MEDICO DE TESTE");
    expect(result.procedure).toBe("Psiquiatra");
  });

  it("lê nome e data/hora, inclusive com celular quebrado em várias linhas e quebra de página", () => {
    expect(result.rows.map((r) => [r.name, r.scheduledAt])).toEqual([
      ["FULANA DE TESTE", "2026-11-16T08:00"],
      ["BELTRANA D'AVILA", "2026-11-16T08:00"],
      ["CICLANO SILVA", "2026-11-16T08:15"],
      ["DEOCLECIO SOUZA", "2026-11-16T13:00"],
      ["ERNESTINA ROSA", "2026-11-16T13:00"],
      ["FABIO SEM TELEFONE", "2026-11-16T13:30"],
      ["GERALDA PAGINA", "2026-11-16T13:45"],
    ]);
    expect(result.unrecognized).toEqual([]);
  });

  it("separa telefones em qualquer máscara e não confunde a idade com telefone", () => {
    const phones = Object.fromEntries(result.rows.map((r) => [r.name, r.phones]));
    // Mesmo número em duas colunas, com e sem máscara: fica um só.
    expect(phones["FULANA DE TESTE"]).toEqual(["47991110001"]);
    // Vários na mesma célula, separados por vírgula e quebrados em linhas.
    expect(phones["BELTRANA D'AVILA"]).toEqual(["(47) 3363-0000", "(47) 99111-0002", "(47) 99111-0003"]);
    // Celular sem o nono dígito, com e sem parênteses.
    expect(phones["CICLANO SILVA"]).toEqual(["47991110004", "(47) 9111-0005", "4791110006"]);
    expect(phones["DEOCLECIO SOUZA"]).toEqual(["(47)99111-0007", "(47)91110-007"]);
    // Telefone de preenchimento "(99)99999-9999" descartado.
    expect(phones["ERNESTINA ROSA"]).toEqual([]);
    expect(phones["FABIO SEM TELEFONE"]).toEqual([]);
    expect(phones["GERALDA PAGINA"]).toEqual(["(47) 99111-0008", "(47) 99111-0009"]);
  });

  it("os telefones viram celulares válidos no mapeamento", () => {
    const drafts = mapExtraction(result).drafts;
    const byName = Object.fromEntries(drafts.map((d) => [d.name, d]));
    expect(byName["BELTRANA D'AVILA"]!.dispatchPhone).toBe("5547991110002");
    expect(byName["CICLANO SILVA"]!.phones).toEqual(["5547991110004", "5547991110005", "5547991110006"]);
    expect(byName["DEOCLECIO SOUZA"]!.phones).toEqual(["5547991110007"]);
    expect(byName["DEOCLECIO SOUZA"]!.invalidPhones).toEqual([]);
  });

  it("situação diferente de Agendado fica destacada", () => {
    const row = result.rows.find((r) => r.name === "ERNESTINA ROSA")!;
    expect(row.confidence).toBeLessThan(0.8);
    expect(row.notes).toContain("Cancelado");
    expect(result.rows.find((r) => r.name === "FULANA DE TESTE")!.confidence).toBe(1);
  });

  it("com mais de uma especialidade/profissional, cada linha leva a sua", () => {
    const multi = parseIpm(`IPM Sistemas Ltda
Relação da Agenda para Contato
Unidade Executante: POLICLINICA MUNICIPAL
Especialidade: Psiquiatra / Profissional: MEDICO UM
PACIENTE Idade Telefone Telefone 2 Telefone 3 Celular Data e Hora Convênio Situação
FULANA UM 40 47991110001 16/11/2026 08:00 SUS Agendado
Especialidade: Neurologista / Profissional: MEDICO DOIS
FULANA DOIS 41 47991110002 16/11/2026 09:00 SUS Agendado`);
    expect(multi.doctor).toBeNull();
    expect(multi.procedure).toBeNull();
    expect(multi.rows.map((r) => [r.doctor, r.procedure])).toEqual([
      ["MEDICO UM", "Psiquiatra"],
      ["MEDICO DOIS", "Neurologista"],
    ]);
    expect(multi.warnings.some((w) => w.includes("2 especialidades"))).toBe(true);
  });

  it("linha que não fecha paciente vira registro não reconhecido, não some", () => {
    const broken = parseIpm(`IPM Sistemas Ltda
Relação da Agenda para Contato
Especialidade: Psiquiatra / Profissional: MEDICO
FULANA SEM DATA 40 47991110001
Quantidade total de agendamentos: 1`);
    expect(broken.rows).toEqual([]);
    expect(broken.unrecognized).toHaveLength(1);
    expect(broken.unrecognized[0]!.name).toBe("FULANA SEM DATA");
    expect(broken.unrecognized[0]!.phones).toEqual(["47991110001"]);
  });
});

describe("splitPhones", () => {
  it.each([
    ["47 99111-0001", ["47 99111-0001"]],
    ["(47) 9 9111-0001", ["(47) 9 9111-0001"]],
    ["47 9911 10001", ["47 9911 10001"]],
    ["(47) 99111-0001; (47) 99111-0002", ["(47) 99111-0001", "(47) 99111-0002"]],
    ["(47) 99111-0001 / 47991110002", ["(47) 99111-0001", "47991110002"]],
    ["+55 47 99111-0001", ["47 99111-0001"]],
  ])("%s", (input, expected) => {
    expect(splitPhones(input)).toEqual(expected);
  });
});
