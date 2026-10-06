import { describe, expect, it } from "vitest";
import { parseCelk } from "./celk.js";

// Fixture sintética (dados fictícios), mas com a estrutura exata do texto
// que o pdf-parse devolve pra um relatório CELK real: uma linha por
// paciente, cabeçalho repetido (filtro + valor limpo), rodapé com
// contagem e a assinatura "CELK SAÚDE vX.X.X.X".
const CELK_TEXT = `Prefeitura Municipal de Exemplópolis
SUS - Sistema Unico de Saude
Página 001 de 001	Relação da Agenda para Contato
CENTRAL DE REGULAÇÃO MUNICIPAL DE EXEMPLÓPOLIS CENTRAL DE REGULAÇÃO MUNICIPAL DE EXEMPLÓPOLIS
Unidade Executante: Múltipla Seleção, 10 itens selecionados Período: de 01/06/2026 até 01/06/2026 Ordenação: Paciente/Data
Profissional: ( 11111111 ) FULANO EXEMPLO DA SILVA Convênio: Todos Tipo Procedimento: ( 99999 ) REG - CONSULTA EM CARDIOLOGIA
Unidade Executante: POLICLINICA MUNICIPAL
Tipo Procedimento: REG - CONSULTA EM CARDIOLOGIA / Profissional: FULANO EXEMPLO DA SILVA
Paciente Idade Telefone Data e Hora	Telefone 1 Telefone 2 Telefone 3 Celular Convênio
MARIA EXEMPLO SOUZA 48 (47) 99637-8418 (47) 99637-8418 01/06/2026 - 08:00 SUS	(47) 99604-2483
JOSE EXEMPLO KUSSNER 82 (47) 99600-2004 47996002004 (47) 99694-8411 01/06/2026 - 08:16 SUS
ANA EXEMPLO PEREIRA 33 4733639309 (47) 99729-2257 01/06/2026 - 08:32 PARTICULAR
30	Quantidade de agendamentos por precedimento:
30	Quantidade total de agendamentos:
CENTRAL DE REGULAÇÃO MUNICIPAL DE EXEMPLÓPOLIS Emitido por FULANA EXEMPLO em 28/05/2026 - 09:52 BRT | CELK SAÚDE v3.1.324.1 - CELK SISTEMAS LTDA`;

describe("parseCelk", () => {
  it("lê o cabeçalho (município, unidade, médico, procedimento)", () => {
    const result = parseCelk(CELK_TEXT);
    expect(result.sourceFormat).toBe("CELK");
    expect(result.municipality).toBe("Exemplópolis");
    expect(result.executingUnit).toBe("POLICLINICA MUNICIPAL");
    expect(result.doctor).toBe("FULANO EXEMPLO DA SILVA");
    expect(result.procedure).toBe("REG - CONSULTA EM CARDIOLOGIA");
  });

  it("extrai uma linha por paciente, ignorando cabeçalho e rodapé", () => {
    const result = parseCelk(CELK_TEXT);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.name)).toEqual([
      "MARIA EXEMPLO SOUZA",
      "JOSE EXEMPLO KUSSNER",
      "ANA EXEMPLO PEREIRA",
    ]);
  });

  it("junta telefone da coluna principal com o telefone extra depois da tabulação", () => {
    const [first] = parseCelk(CELK_TEXT).rows;
    expect(first?.phones).toEqual(["(47) 99637-8418", "(47) 99637-8418", "(47) 99604-2483"]);
  });

  it("reconhece telefone cru (sem formatação) junto com o formatado", () => {
    const [, second] = parseCelk(CELK_TEXT).rows;
    expect(second?.phones).toEqual(["(47) 99600-2004", "(47) 99694-8411", "47996002004"]);
  });

  it("converte data e hora pro formato ISO", () => {
    const [first] = parseCelk(CELK_TEXT).rows;
    expect(first?.scheduledAt).toBe("2026-06-01T08:00");
  });

  it("guarda o convênio em notes só quando não é SUS", () => {
    const [first, , third] = parseCelk(CELK_TEXT).rows;
    expect(first?.notes).toBeNull();
    expect(third?.notes).toBe("Convênio: PARTICULAR");
  });

  it("não deixa o rodapé 'Emitido por ... HH:MM' virar paciente", () => {
    const result = parseCelk(CELK_TEXT);
    expect(result.rows.some((row) => row.name.includes("Emitido"))).toBe(false);
  });

  it("avisa quando nenhuma linha de paciente é reconhecida", () => {
    const result = parseCelk("CELK SAÚDE v1.0.0.0\nnada aqui bate com o formato esperado");
    expect(result.rows).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("vários procedimentos no mesmo PDF: cada paciente leva o procedimento da sua seção", () => {
    const text = `Prefeitura Municipal de Exemplópolis
Página 001 de 001	Relação da Agenda para Contato
Unidade Executante: Múltipla Seleção, 10 itens selecionados Período: de 14/10/2026 até 14/10/2026 Ordenação: Paciente/Data
Profissional: ( 1 ) DOUTOR EXEMPLO Convênio: Todos Tipo Procedimento: Todos
Unidade Executante: POLICLINICA
Tipo Procedimento: ULTRASSONOGRAFIA OBSTETRICO / Profissional: DOUTOR EXEMPLO
Paciente Idade Telefone Data e Hora	Telefone 1 Telefone 2 Telefone 3 Celular Convênio
GESTANTE UM EXEMPLO 25 (47) 99000-0001 14/10/2026 - 08:00 SUS
GESTANTE DOIS EXEMPLO 31 (47) 99000-0002 14/10/2026 - 08:20 SUS
2	Quantidade de agendamentos por precedimento:
Tipo Procedimento: ULTRASSONOGRAFIA DE MAMA / Profissional: DOUTOR EXEMPLO
Paciente Idade Telefone Data e Hora	Telefone 1 Telefone 2 Telefone 3 Celular Convênio
PACIENTE TRES EXEMPLO 52 (47) 99000-0003 14/10/2026 - 13:00 SUS
PACIENTE QUATRO EXEMPLO 48 (47) 99000-0004 14/10/2026 - 13:20 SUS
2	Quantidade de agendamentos por precedimento:
4	Quantidade total de agendamentos:
Emitido por FULANA em 02/10/2026 - 13:24 BRT | CELK SAÚDE v3.1.342.1 - CELK SISTEMAS LTDA`;
    const result = parseCelk(text);
    expect(result.rows.map((r) => [r.name, r.procedure])).toEqual([
      ["GESTANTE UM EXEMPLO", "ULTRASSONOGRAFIA OBSTETRICO"],
      ["GESTANTE DOIS EXEMPLO", "ULTRASSONOGRAFIA OBSTETRICO"],
      ["PACIENTE TRES EXEMPLO", "ULTRASSONOGRAFIA DE MAMA"],
      ["PACIENTE QUATRO EXEMPLO", "ULTRASSONOGRAFIA DE MAMA"],
    ]);
    expect(result.procedure).toBeNull(); // não existe um só procedimento no cabeçalho
    expect(result.warnings.join(" ")).toMatch(/2 procedimentos/);
  });

  it("um único procedimento continua vindo só do cabeçalho (linhas sem procedimento próprio)", () => {
    const result = parseCelk(CELK_TEXT);
    expect(result.procedure).toBe("REG - CONSULTA EM CARDIOLOGIA");
    expect(result.rows.every((r) => r.procedure === null)).toBe(true);
  });
});
