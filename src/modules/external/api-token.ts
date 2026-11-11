import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/*
  Token de acesso da integração externa (GPT do ChatGPT, pedido de
  2026-11-11). Puro, sem banco — testado em api-token.test.ts.

  Formato: `rgl_` + 40 caracteres base64url (30 bytes aleatórios, ~240 bits).
  Com essa entropia um SHA-256 simples basta pra guardar (não é senha
  escolhida por gente, não tem dicionário pra atacar) — e permite achar o
  token pelo hash com um índice único, sem varrer a tabela.
*/

export const TOKEN_PREFIX = "rgl_";
const TOKEN_PATTERN = /^rgl_[A-Za-z0-9_-]{40}$/;

export function generateApiToken(): { token: string; hash: string; displayPrefix: string } {
  const token = TOKEN_PREFIX + randomBytes(30).toString("base64url");
  return { token, hash: hashApiToken(token), displayPrefix: token.slice(0, 10) };
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function looksLikeApiToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** Tira o token do cabeçalho `Authorization: Bearer <token>`; `null` se não vier no formato. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const candidate = match?.[1];
  if (!candidate) return null;
  return looksLikeApiToken(candidate) ? candidate : null;
}

/** Comparação de hash em tempo constante (defesa extra; a busca já é por índice). */
export function hashesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
