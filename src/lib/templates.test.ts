import { describe, expect, it } from "vitest";
import { classifyReply } from "@/lib/templates.js";

describe("classifyReply — clique de botão", () => {
  it("entende os botões dos três templates", () => {
    expect(classifyReply({ buttonPayload: "Sim, vou comparecer" })).toBe("confirm");
    expect(classifyReply({ buttonPayload: "Confirmado, estarei lá" })).toBe("confirm");
    expect(classifyReply({ buttonPayload: "Sim, quero a vaga" })).toBe("confirm");
    expect(classifyReply({ buttonPayload: "Não poderei ir" })).toBe("refuse");
    expect(classifyReply({ buttonPayload: "Não poderei mais ir" })).toBe("refuse");
    expect(classifyReply({ buttonPayload: "Não, obrigado" })).toBe("refuse");
  });
});

describe("classifyReply — texto livre", () => {
  it("aceita as respostas curtas óbvias", () => {
    expect(classifyReply({ text: "Sim" })).toBe("confirm");
    expect(classifyReply({ text: "sim" })).toBe("confirm");
    expect(classifyReply({ text: "confirmo" })).toBe("confirm");
    expect(classifyReply({ text: "ok" })).toBe("confirm");
  });

  it("entende recusa escrita", () => {
    expect(classifyReply({ text: "não posso ir" })).toBe("refuse");
    expect(classifyReply({ text: "nao vou poder" })).toBe("refuse");
    expect(classifyReply({ text: "quero cancelar" })).toBe("refuse");
  });

  it("não confunde negação com confirmação", () => {
    // O caso que motivou o cuidado: "sim, mas..." não é confirmação.
    expect(classifyReply({ text: "sim mas nao vou poder" })).toBe("refuse");
    expect(classifyReply({ text: "não" })).toBe("unknown");
  });

  it("marca opt-out", () => {
    expect(classifyReply({ text: "SAIR" })).toBe("opt_out");
    expect(classifyReply({ text: "parar" })).toBe("opt_out");
  });

  it("devolve unknown quando não dá pra ter certeza", () => {
    // Respostas reais desse tipo aparecem nos prints da operação atual.
    expect(classifyReply({ text: "Tá conseguindo" })).toBe("unknown");
    expect(classifyReply({ text: "Posso confirmar?" })).toBe("unknown");
    expect(classifyReply({ text: "" })).toBe("unknown");
    expect(classifyReply({})).toBe("unknown");
  });
});
