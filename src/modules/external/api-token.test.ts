import { describe, expect, it } from "vitest";
import { extractBearerToken, generateApiToken, hashApiToken, hashesMatch, looksLikeApiToken } from "./api-token.js";

describe("api-token", () => {
  it("gera token no formato esperado, com hash e prefixo de exibição", () => {
    const { token, hash, displayPrefix } = generateApiToken();
    expect(looksLikeApiToken(token)).toBe(true);
    expect(hash).toBe(hashApiToken(token));
    expect(hash).toHaveLength(64);
    expect(token.startsWith(displayPrefix)).toBe(true);
    expect(displayPrefix).toHaveLength(10);
  });

  it("dois tokens nunca saem iguais", () => {
    expect(generateApiToken().token).not.toBe(generateApiToken().token);
  });

  it("lê o token só do cabeçalho Bearer no formato certo", () => {
    const { token } = generateApiToken();
    expect(extractBearerToken(`Bearer ${token}`)).toBe(token);
    expect(extractBearerToken(`bearer ${token}`)).toBe(token);
    expect(extractBearerToken(token)).toBeNull();
    expect(extractBearerToken("Bearer abc")).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken(`Bearer ${token} extra`)).toBeNull();
  });

  it("compara hash", () => {
    const h = hashApiToken("rgl_x");
    expect(hashesMatch(h, h)).toBe(true);
    expect(hashesMatch(h, hashApiToken("rgl_y"))).toBe(false);
  });
});
