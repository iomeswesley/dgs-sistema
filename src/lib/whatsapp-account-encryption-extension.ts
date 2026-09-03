import { Prisma } from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/token-crypto.js";

// Extensão do Prisma que criptografa/decripta `WhatsappAccount.accessToken`
// automaticamente — acrescentada em 2026-09-03 pra fechar o achado da
// revisão de segurança de 2026-09-02 (token gravado em texto puro).
//
// Escolhido em vez de criptografar/decriptar em cada call site
// (`getActiveCredentials`, `listAccounts`, `signup.routes.ts`, etc.) porque
// é fácil esquecer um lugar e vazar o texto puro de novo, ou pior, gravar
// texto puro por engano; centralizado aqui, todo `prisma.whatsappAccount.*`
// (presente e futuro) já sai/entra decriptado sem precisar lembrar disso —
// mesmo padrão estrutural da extensão de isolamento por cliente
// (`tenant-prisma-extension.ts`).
//
// Cobre `create`/`update` (os dois únicos pontos que gravam accessToken
// hoje, em whatsapp-account.service.ts) e qualquer leitura
// (`find*`) que traga a coluna de volta.
function encryptDataAccessToken(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(encryptDataAccessToken);
  if (data && typeof data === "object" && "accessToken" in data) {
    const record = data as Record<string, unknown>;
    if (typeof record.accessToken === "string") {
      return { ...record, accessToken: encryptSecret(record.accessToken) };
    }
  }
  return data;
}

function decryptResultAccessToken<T>(result: T): T {
  if (Array.isArray(result)) return result.map(decryptResultAccessToken) as unknown as T;
  if (result && typeof result === "object" && "accessToken" in result) {
    const record = result as Record<string, unknown>;
    if (typeof record.accessToken === "string") {
      return { ...record, accessToken: decryptSecret(record.accessToken) } as unknown as T;
    }
  }
  return result;
}

export const whatsappAccountEncryptionExtension = Prisma.defineExtension({
  name: "whatsappAccountEncryption",
  query: {
    whatsappAccount: {
      async $allOperations({ args, query }) {
        const nextArgs = args as { data?: unknown };
        if (nextArgs.data !== undefined) {
          nextArgs.data = encryptDataAccessToken(nextArgs.data);
        }
        const result = await query(args);
        return decryptResultAccessToken(result);
      },
    },
  },
});
