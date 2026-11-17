import { describe, expect, it } from "vitest";
import { renderTemplateText } from "@/lib/whatsapp-templates.js";

const BODY = ["Maria", "Botuverá", "20/11/2026", "08:00", "Ultrassonografia", "USF Willy Maestri - Rua João Morelli, 65"];

describe("renderTemplateText — remetente do cliente", () => {
  it("sem remetente, mantém o texto da DGS", () => {
    const text = renderTemplateText("confirmacao_consulta", ["Botuverá"], BODY);
    expect(text).toContain("Aqui é a DGS");
  });

  it("com remetente, o texto gravado bate com o template da Secretaria", () => {
    const text = renderTemplateText("confirmacao_consulta", ["Botuverá"], BODY, "Secretaria Municipal de Saúde de Botuverá");
    expect(text).not.toContain("DGS");
    expect(text).toContain("Aqui é a Secretaria de Saúde de Botuverá.");
  });

  it("oferta preenche as 6 variáveis", () => {
    const text = renderTemplateText("oferta_vaga_consulta", undefined, ["Maria", "Botuverá", "Ultrassonografia", "20/11/2026", "08:00", "USF"]);
    expect(text).toContain("consulta de Ultrassonografia reservada");
    expect(text).toContain("Data: 20/11/2026 às 08:00");
  });
});
