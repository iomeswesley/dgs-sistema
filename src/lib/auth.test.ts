import { describe, expect, it } from "vitest";
import { generateRandomPassword, generateResetToken, hashPassword, hashToken, verifyPassword } from "@/lib/auth.js";

describe("hashPassword / verifyPassword", () => {
  it("aceita a senha correta e rejeita a errada", () => {
    const stored = hashPassword("senha-secreta");
    expect(verifyPassword("senha-secreta", stored)).toBe(true);
    expect(verifyPassword("senha-errada", stored)).toBe(false);
  });

  it("gera hashes diferentes pra mesma senha (salt aleatório)", () => {
    expect(hashPassword("igual")).not.toBe(hashPassword("igual"));
  });

  it("não quebra com hash malformado no banco", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "sem-separador")).toBe(false);
    expect(verifyPassword("x", "salt:naohex")).toBe(false);
  });
});

describe("generateRandomPassword", () => {
  it("respeita o tamanho e evita caracteres ambíguos", () => {
    const password = generateRandomPassword(16);
    expect(password).toHaveLength(16);
    expect(password).not.toMatch(/[0O1lI]/);
  });
});

describe("generateResetToken", () => {
  it("devolve o token cru junto do hash que vai pro banco", () => {
    const { token, tokenHash } = generateResetToken();
    expect(tokenHash).not.toBe(token);
    expect(hashToken(token)).toBe(tokenHash);
  });
});
