import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cada teste que precisa de uma TOKEN_ENCRYPTION_KEY específica recarrega o
// módulo depois de mexer em process.env — `config/env.ts` só lê a variável
// uma vez, no import (ver token-crypto.ts), então reusar o módulo já
// carregado não refletiria uma troca de chave no meio do teste.
async function loadWithKey(key: string | undefined) {
  vi.resetModules();
  // `config/env.ts` valida o ambiente inteiro no import (falha rápido se
  // faltar variável obrigatória) — precisa das 3 sempre presentes mesmo
  // quando o teste só se importa com TOKEN_ENCRYPTION_KEY.
  vi.stubEnv("DATABASE_URL", "postgres://test");
  vi.stubEnv("DIRECT_URL", "postgres://test");
  vi.stubEnv("SESSION_SECRET", "test-secret");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", key);
  return import("@/lib/token-crypto.js");
}

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("faz ida e volta com a chave certa", async () => {
    const { encryptSecret, decryptSecret } = await loadWithKey(KEY_A);
    const stored = encryptSecret("token-secreto-da-meta");
    expect(stored).not.toBe("token-secreto-da-meta");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptSecret(stored)).toBe("token-secreto-da-meta");
  });

  it("gera saída diferente pro mesmo valor (iv aleatório)", async () => {
    const { encryptSecret } = await loadWithKey(KEY_A);
    expect(encryptSecret("igual")).not.toBe(encryptSecret("igual"));
  });

  it("não decripta com a chave errada", async () => {
    const { encryptSecret } = await loadWithKey(KEY_A);
    const stored = encryptSecret("token-secreto");
    const { decryptSecret } = await loadWithKey(KEY_B);
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("trata valor sem prefixo 'v1:' como texto puro legado, sem quebrar", async () => {
    const { decryptSecret } = await loadWithKey(KEY_A);
    expect(decryptSecret("EAAGtokenCru123")).toBe("EAAGtokenCru123");
  });

  it("sem TOKEN_ENCRYPTION_KEY configurado, grava em texto puro em vez de quebrar (dev local)", async () => {
    const { encryptSecret, decryptSecret } = await loadWithKey(undefined);
    const stored = encryptSecret("token-dev");
    expect(stored).toBe("token-dev"); // sem chave, não criptografa
    expect(decryptSecret(stored)).toBe("token-dev");
  });

  it("recusa decriptar dado criptografado se a chave sumiu depois", async () => {
    const { encryptSecret } = await loadWithKey(KEY_A);
    const stored = encryptSecret("token-secreto");
    const { decryptSecret } = await loadWithKey(undefined);
    expect(() => decryptSecret(stored)).toThrow();
  });
});
