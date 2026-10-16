import { describe, expect, it } from "vitest";
import { detectFormat } from "./detect.js";
import { parseCisamve } from "./cisamve.js";

// Mesma estrutura do relatório real "Agendamento de Exames" do CISAMVE
// (2026-10-16) — nomes fictícios.
const SAMPLE = `CISAMVE-CONS PUB INTER SAÚDE E SERV VALE EUROPEU C.N.P.J.: 03.269.695/0001-08
Agendamento de Exames
Página: 1 de 1
Data: 16/10/2026
Horário: 13:15:14
Tipo = Autorizações de Exames
Situação = Agendado
Unidade de Saúde de Origem = 1471
Laboratório = 1540
Data = 17/10/2026
Descrição do Exame Data Horário Nome do Usuário
DOPPLER COLORIDO VENOSO DE MEMBRO INFERIOR (UNILATERAL)\t17/10/2026 08:00:00 FULANA DE TESTE
DOPPLER COLORIDO DE VASOS (ATÉ 3 VASOS) 17/10/2026 08:05:00 BELTRANO SILVA
DOPPLER COLORIDO DE VASOS CERVICAIS ARTERIAIS BILATERAL (CARÓTIDAS E VERTEBRAIS)\t17/10/2026 13:30:00 CICLANA D'AVILA
IDS Desenvolvimento de Software & Assessoria Ltda - IDS Saúde 7.26.5.27 Programa: TDmAgeExa5186 - Modelo.fr3

-- 1 of 1 --`;

describe("parseCisamve", () => {
  it("é reconhecido pelo cabeçalho da tabela", () => {
    expect(detectFormat(SAMPLE)).toBe("CISAMVE");
  });

  const result = parseCisamve(SAMPLE);

  it("lê exame, data/hora e nome de cada linha", () => {
    expect(result.sourceFormat).toBe("CISAMVE");
    expect(result.rows.map((r) => [r.name, r.scheduledAt])).toEqual([
      ["FULANA DE TESTE", "2026-10-17T08:00"],
      ["BELTRANO SILVA", "2026-10-17T08:05"],
      ["CICLANA D'AVILA", "2026-10-17T13:30"],
    ]);
  });

  it("guarda o exame inteiro por linha, com parênteses e dígitos", () => {
    expect(result.rows.map((r) => r.procedure)).toEqual([
      "DOPPLER COLORIDO VENOSO DE MEMBRO INFERIOR (UNILATERAL)",
      "DOPPLER COLORIDO DE VASOS (ATÉ 3 VASOS)",
      "DOPPLER COLORIDO DE VASOS CERVICAIS ARTERIAIS BILATERAL (CARÓTIDAS E VERTEBRAIS)",
    ]);
  });

  it("não inventa telefone nem lê cabeçalho/rodapé como paciente", () => {
    expect(result.rows.every((r) => r.phones.length === 0)).toBe(true);
    expect(result.rows).toHaveLength(3);
    expect(result.warnings.some((w) => w.includes("não traz telefone"))).toBe(true);
  });
});
