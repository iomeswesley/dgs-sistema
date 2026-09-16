import { describe, expect, it } from "vitest";
import { exactNameMatch, findClosestMatch, findUniqueMatch, namesMatch } from "./text-match.js";

describe("exactNameMatch", () => {
  it("bate ignorando acento e caixa", () => {
    expect(exactNameMatch("Camboriú", "CAMBORIU")).toBe(true);
  });

  it("não bate por conter — cidades vizinhas de nome parecido são municípios diferentes", () => {
    expect(exactNameMatch("Camboriú", "Balneário Camboriú")).toBe(false);
  });
});

describe("namesMatch", () => {
  it("bate ignorando acento e caixa", () => {
    expect(namesMatch("Camboriú", "CAMBORIU")).toBe(true);
  });

  it("bate quando um nome contém o outro (unidade com nome encurtado)", () => {
    expect(namesMatch("POLICLINICA MUNICIPAL", "POLICLINICA MUNICIPAL PREFEITO ALWIN KLOTZ")).toBe(true);
    expect(namesMatch("UBS SAO JOAO", "SAO JOAO")).toBe(true);
  });

  it("não bate entre nomes sem relação", () => {
    expect(namesMatch("Pomerode", "Indaial")).toBe(false);
  });
});

describe("findUniqueMatch", () => {
  const cities = [{ name: "Camboriú" }, { name: "Balneário Camboriú" }, { name: "Indaial" }];

  it("acha o único candidato que bate", () => {
    expect(findUniqueMatch("INDAIAL", cities, (c) => c.name)).toEqual({ name: "Indaial" });
  });

  it("devolve null quando ninguém bate", () => {
    expect(findUniqueMatch("Blumenau", cities, (c) => c.name)).toBeNull();
  });

  it("devolve null quando o valor de entrada é null", () => {
    expect(findUniqueMatch(null, cities, (c) => c.name)).toBeNull();
  });

  it("modo exact não deixa 'Camboriú' casar com 'Balneário Camboriú'", () => {
    expect(findUniqueMatch("Camboriú", cities, (c) => c.name, { exact: true })).toEqual({ name: "Camboriú" });
  });

  it("sem modo exact, 'Camboriú' fica ambíguo entre as duas cidades e devolve null", () => {
    expect(findUniqueMatch("Camboriú", cities, (c) => c.name)).toBeNull();
  });
});

describe("findClosestMatch", () => {
  const patients = [
    { name: "GABRIELA NATALIE DA SILVA PINTO" },
    { name: "ELIANE APARECIDA ATANKEVICZ" },
    { name: "MARIA CLAUDIA SILVA DE LIRA MACEDO" },
  ];

  it("usa contém/igual primeiro quando resolve sozinho (mesmo caso de findUniqueMatch)", () => {
    expect(findClosestMatch("MARIA CLAUDIA SILVA DE LIRA MACEDO", patients, (p) => p.name)).toEqual({
      name: "MARIA CLAUDIA SILVA DE LIRA MACEDO",
    });
  });

  it("tolera pequena diferença de grafia entre duas fontes (achado real, lista CISAMVE × cadastro)", () => {
    expect(findClosestMatch("GABRIELA NATALI DA SILVA PINTO", patients, (p) => p.name)).toEqual({
      name: "GABRIELA NATALIE DA SILVA PINTO",
    });
    expect(findClosestMatch("ELIANE APARECIDA ATANKEVCZ", patients, (p) => p.name)).toEqual({
      name: "ELIANE APARECIDA ATANKEVICZ",
    });
  });

  it("não adivinha quando nenhum candidato está perto o bastante", () => {
    expect(findClosestMatch("FULANO COMPLETAMENTE DIFERENTE", patients, (p) => p.name)).toBeNull();
  });

  it("não adivinha quando dois candidatos ficam igualmente perto (ambíguo)", () => {
    const twins = [{ name: "ANA MARIA SILVA" }, { name: "ANA MARIA SILVO" }];
    expect(findClosestMatch("ANA MARIA SILVX", twins, (p) => p.name)).toBeNull();
  });
});
