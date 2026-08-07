import { describe, expect, it } from "vitest";
import { exactNameMatch, findUniqueMatch, namesMatch } from "./text-match.js";

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
