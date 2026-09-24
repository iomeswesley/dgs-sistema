import { describe, expect, it } from "vitest";
import { contactLeadSchema, isHoneypotFilled } from "@/modules/leads/leads.schema.js";

const valid = {
  name: "Maria Souza",
  organization: "Secretaria de Saúde de Exemplo",
  role: "Coordenadora",
  phone: "(47) 99999-1234",
  email: "maria@exemplo.gov.br",
  message: "Queremos conhecer.",
  consent: true,
};

function firstError(input: unknown): string | undefined {
  const result = contactLeadSchema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe("contactLeadSchema", () => {
  it("aceita um contato completo", () => {
    expect(contactLeadSchema.safeParse(valid).success).toBe(true);
  });

  it("aceita cargo e mensagem vazios", () => {
    expect(contactLeadSchema.safeParse({ ...valid, role: "", message: "" }).success).toBe(true);
  });

  it("explica o motivo do telefone inválido", () => {
    expect(firstError({ ...valid, phone: "4799" })).toMatch(/dígito/);
  });

  it("exige consentimento", () => {
    expect(firstError({ ...valid, consent: false })).toBe("É preciso autorizar o contato para enviar.");
  });

  it("rejeita e-mail inválido", () => {
    expect(firstError({ ...valid, email: "maria@" })).toBe("E-mail inválido.");
  });
});

describe("isHoneypotFilled", () => {
  it("só dispara quando o campo-isca tem conteúdo", () => {
    expect(isHoneypotFilled({})).toBe(false);
    expect(isHoneypotFilled({ website: "  " })).toBe(false);
    expect(isHoneypotFilled({ website: "http://spam" })).toBe(true);
  });
});
