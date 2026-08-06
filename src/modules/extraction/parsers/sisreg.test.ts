import { describe, expect, it } from "vitest";
import { parseSisreg } from "./sisreg.js";

// Fixture sintética (dados fictícios), reproduzindo as duas variantes de
// cabeçalho já vistas em listas reais e as fragmentações de linha típicas
// do SISREG: CNS e nascimento às vezes quebrados no meio, telefone cortado
// logo depois do hífen, "Nome Social" vazio ("---") e código de solicitação
// que às vezes vem colado ao dia da semana na mesma linha.
const SISREG_TEXT = `PROPRIEDADES DA AGENDA	PROPRIEDADES DA AGENDA
Unidade Executante: 	POLICLINICA MUNICIPAL EXEMPLO (0000000)
Período: 	25/07/2026 a 25/07/2026
Profissional Executante: FULANO EXEMPLO DA SILVA (00000000000)
Procedimento Ambulatorial: GRUPO - EXAMES EXEMPLO (0000000)
Ordenado por: 	DATA/HORA DA MARCACAO
Resultados por página: 	TODOS
Cod.
Solic, Data/Hora 	CNS 	Nome 	Nome
Social Nascimento Idade Origem Telefone(s) Unidade
Solicitante
Vaga
Solicitada Procedimento CID-
10
679232319
SAB
25/07/2026
08:00
704801008439444 MARIA
EXEMPLO 	--- 19/11/1964 	61 EXEMPLOPOLIS
- SC
(47) 3387-
2221
(47) 99903-
3484
SECRETARIA
MUNICIPAL
DE SAUDE
DE
EXEMPLOPOLIS
1ª VEZ
01 - EXAME
EXEMPLO
I70
653979313	SAB
25/07/2026
08:10
706906142901432 JOSE
EXEMPLO 	--- 16/04/1965 	61 EXEMPLOPOLIS
- SC
(47) 99237-
3439
SECRETARIA
MUNICIPAL
DE SAUDE
DE
EXEMPLOPOLIS
RETORNO
01 - EXAME
EXEMPLO
Z136
`;

describe("parseSisreg", () => {
  it("lê o cabeçalho mesmo com o rótulo 'Unidade Executante:'", () => {
    const result = parseSisreg(SISREG_TEXT);
    expect(result.sourceFormat).toBe("SISREG");
    expect(result.municipality).toBe("EXEMPLOPOLIS");
    expect(result.executingUnit).toBe("POLICLINICA MUNICIPAL EXEMPLO");
    expect(result.doctor).toBe("FULANO EXEMPLO DA SILVA");
    expect(result.procedure).toBe("GRUPO - EXAMES EXEMPLO");
  });

  it("lê o cabeçalho sem o rótulo (variante mais simples)", () => {
    const semRotulo = `PROPRIEDADES DA AGENDA
UNIDADE SEM ROTULO (1234567)
Profissional Executante: FULANO EXEMPLO (00000000000)
Procedimento Ambulatorial: CONSULTA EXEMPLO (0000000)
573481001
QUI
25/06/2026
07:20
700001111100001 MARIA EXEMPLO SOUZA 13/05/1993
33 EXEMPLOPOLIS - SC
(47) 98000-0001
UBS EXEMPLO
1a VEZ
R68`;
    const result = parseSisreg(semRotulo);
    expect(result.executingUnit).toBe("UNIDADE SEM ROTULO");
  });

  it("extrai os dois registros, mesmo com o código de solicitação colado ao dia da semana", () => {
    const result = parseSisreg(SISREG_TEXT);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.name)).toEqual(["MARIA EXEMPLO", "JOSE EXEMPLO"]);
  });

  it("reconstrói o CNS quebrado no meio da linha", () => {
    const [first] = parseSisreg(SISREG_TEXT).rows;
    expect(first?.cns).toBe("704801008439444");
  });

  it("reconstrói o nascimento quebrado no último dígito do ano", () => {
    const [first] = parseSisreg(SISREG_TEXT).rows;
    expect(first?.birthDate).toBe("1964-11-19");
  });

  it("reconstrói o telefone cortado logo depois do hífen", () => {
    const [first] = parseSisreg(SISREG_TEXT).rows;
    expect(first?.phones).toEqual(["(47) 3387-2221", "(47) 99903-3484"]);
  });

  it("converte data e hora pro formato ISO", () => {
    const [first] = parseSisreg(SISREG_TEXT).rows;
    expect(first?.scheduledAt).toBe("2026-07-25T08:00");
  });

  it("reconhece '1ª VEZ' como primeira vez e 'RETORNO' como retorno", () => {
    const [first, second] = parseSisreg(SISREG_TEXT).rows;
    expect(first?.isFirstVisit).toBe(true);
    expect(second?.isFirstVisit).toBe(false);
  });

  it("monta a unidade solicitante juntando as linhas quebradas", () => {
    const [first] = parseSisreg(SISREG_TEXT).rows;
    expect(first?.requestingUnit).toBe("SECRETARIA MUNICIPAL DE SAUDE DE EXEMPLOPOLIS");
  });

  it("nunca inclui o CID-10 em nenhum campo do resultado", () => {
    const result = parseSisreg(SISREG_TEXT);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/\bI70\b/);
    expect(serialized).not.toMatch(/\bZ136\b/);
  });

  it("marca confiança alta quando CNS e nascimento foram reconhecidos", () => {
    const [first] = parseSisreg(SISREG_TEXT).rows;
    expect(first?.confidence).toBe(1);
    expect(first?.notes).toBeNull();
  });

  it("avisa quando nenhum registro é reconhecido", () => {
    const result = parseSisreg("PROPRIEDADES DA AGENDA\nnada aqui bate com o formato esperado");
    expect(result.rows).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
