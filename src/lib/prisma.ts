import { PrismaClient } from "@prisma/client";
import { isProduction } from "@/config/env.js";
import { tenantIsolationExtension } from "@/lib/tenant-prisma-extension.js";

// Reaproveita a instância entre reloads do tsx watch em dev, pra não abrir
// uma pool nova de conexões a cada mudança de arquivo.
const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrismaClient };

function buildClient() {
  const base = new PrismaClient({
    log: ["error", "warn"],
  });
  // Isolamento por cliente (PLANO-MULTICLIENTE.md, Fase 1) — injeta
  // clientId automaticamente em toda query dos modelos isolados, a partir
  // do contexto aberto por `requireAuth`/cron/webhook (ver
  // src/lib/tenant-context.ts). Fail-closed: fora de contexto, lança.
  return base.$extends(tenantIsolationExtension);
}

type ExtendedPrismaClient = ReturnType<typeof buildClient>;

export const prisma: ExtendedPrismaClient = globalForPrisma.prisma ?? buildClient();

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
