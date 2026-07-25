import { PrismaClient } from "@prisma/client";
import { isProduction } from "@/config/env.js";

// Reaproveita a instância entre reloads do tsx watch em dev, pra não abrir
// uma pool nova de conexões a cada mudança de arquivo.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
