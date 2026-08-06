import { describe, expect, it } from "vitest";
import { detectFormat } from "./detect.js";

describe("detectFormat", () => {
  it("reconhece CELK pela assinatura no rodapé", () => {
    expect(detectFormat("...\nCELK SAÚDE v3.1.324.1 - CELK SISTEMAS LTDA")).toBe("CELK");
  });

  it("reconhece SISREG pelo nome do sistema", () => {
    expect(detectFormat("SISREG III - Servidor de Producao\n...")).toBe("SISREG");
  });

  it("reconhece SISREG pelo cabeçalho quando o nome do sistema não aparece", () => {
    expect(detectFormat("PROPRIEDADES DA AGENDA\n...")).toBe("SISREG");
  });

  it("devolve OUTRO quando não bate com nenhum formato conhecido", () => {
    expect(detectFormat("um relatório qualquer de outro sistema")).toBe("OUTRO");
  });
});
