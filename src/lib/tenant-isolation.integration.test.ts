// Teste de integração do isolamento por cliente — PLANO-MULTICLIENTE.md,
// seção 6: "Teste automatizado com 2 clientes provando que a query de um
// nunca vê o outro". Diferente do resto da suíte, este teste PRECISA de um
// banco de verdade — e só roda contra o banco de TESTE (Supabase separado
// da branch multicliente, nunca produção).
//
// Segurança, em camadas:
//   1. Não lê a `DATABASE_URL` do ambiente (nunca toca no `.env` de
//      produção que outros comandos deste projeto usam) — lê só o arquivo
//      local `.env.multicliente` (fora do git, ver .gitignore) direto do
//      disco, sem tocar em `process.env`.
//   2. Se esse arquivo não existir (qualquer outra máquina, CI), a suíte
//      inteira é pulada — não falha, só não roda. `npm test` continua
//      100% independente de banco no resto do projeto.
//   3. Antes de qualquer escrita, confirma que a connection string aponta
//      pro projeto de TESTE (`qiacbjpsjkkeeaaflmum`) e recusa rodar se
//      detectar o projeto de PRODUÇÃO (`koplspjaqazgsvcaspmp`) — cinto e
//      suspensório, mesmo sendo arquivos diferentes.
//   4. Cria seus próprios 2 clientes de teste e limpa tudo no final
//      (`afterAll`), sem depender de nem sujar dado nenhum que já exista
//      no banco de teste.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MissingTenantContextError, runAsSuperAdmin, runWithClient } from "@/lib/tenant-context.js";
import { tenantIsolationExtension } from "@/lib/tenant-prisma-extension.js";

const ENV_FILE = path.resolve(__dirname, "../../.env.multicliente");
const TEST_PROJECT_REF = "qiacbjpsjkkeeaaflmum";
const PRODUCTION_PROJECT_REF = "koplspjaqazgsvcaspmp";

function readDatabaseUrl(): string | null {
  if (!existsSync(ENV_FILE)) return null;
  const content = readFileSync(ENV_FILE, "utf-8");
  const match = content.match(/^DATABASE_URL="?([^"\n]+)"?/m);
  return match?.[1] ?? null;
}

const databaseUrl = readDatabaseUrl();

describe.skipIf(!databaseUrl)("isolamento por cliente (banco de teste real)", () => {
  let prisma: ReturnType<typeof buildClient>;
  let clientA: number;
  let clientB: number;

  function buildClient() {
    if (!databaseUrl) throw new Error("sem databaseUrl — describe.skipIf deveria ter pulado");
    if (databaseUrl.includes(PRODUCTION_PROJECT_REF)) {
      throw new Error(
        "SEGURANÇA: .env.multicliente aponta pro projeto de PRODUÇÃO — recusando rodar o teste.",
      );
    }
    if (!databaseUrl.includes(TEST_PROJECT_REF)) {
      throw new Error(
        `SEGURANÇA: .env.multicliente não aponta pro projeto de teste esperado (${TEST_PROJECT_REF}) — recusando rodar.`,
      );
    }
    const base = new PrismaClient({ datasourceUrl: databaseUrl });
    return base.$extends(tenantIsolationExtension);
  }

  beforeAll(async () => {
    prisma = buildClient();
    const a = await prisma.client.create({
      data: { name: `__teste_isolamento_A_${Date.now()}` },
    });
    const b = await prisma.client.create({
      data: { name: `__teste_isolamento_B_${Date.now()}` },
    });
    clientA = a.id;
    clientB = b.id;
  });

  afterAll(async () => {
    // Limpeza via super admin — os municípios criados no teste referenciam
    // clientA/clientB, apagar nessa ordem evita violar a FK.
    await runAsSuperAdmin(async () => {
      await prisma.municipality.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    });
    await prisma.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
    await prisma.$disconnect();
  });

  it("fail-closed: query sem contexto nenhum lança, nunca devolve o banco inteiro", async () => {
    await expect(prisma.municipality.findMany()).rejects.toThrow(MissingTenantContextError);
  });

  it("um cliente nunca vê o dado criado pelo outro", async () => {
    // clientId errado de propósito nos dois `create` — o objetivo é provar
    // que a extensão SOBRESCREVE com o clientId do contexto ativo (se não
    // sobrescrevesse, os dois cairiam no cliente errado e as asserções
    // abaixo, que leem pelo clientId de verdade, veriam listas vazias).
    await runWithClient(clientA, async () => {
      await prisma.municipality.create({ data: { name: "Camboriú", state: "SC", clientId: -1 } });
    });
    await runWithClient(clientB, async () => {
      await prisma.municipality.create({ data: { name: "Blumenau", state: "SC", clientId: -1 } });
    });

    const seenByA = await runWithClient(clientA, () => prisma.municipality.findMany());
    const seenByB = await runWithClient(clientB, () => prisma.municipality.findMany());

    expect(seenByA.map((m) => m.name)).toEqual(["Camboriú"]);
    expect(seenByB.map((m) => m.name)).toEqual(["Blumenau"]);

    // Confirma isolamento mesmo pedindo EXPLICITAMENTE o município do outro
    // cliente por id — não é só que a listagem filtra, é que a linha nem
    // existe do ponto de vista de quem está no cliente errado.
    expect(seenByB).toHaveLength(1);
    const blumenauId = seenByB[0]!.id;
    const stolen = await runWithClient(clientA, () =>
      prisma.municipality.findUnique({ where: { id: blumenauId } }),
    );
    expect(stolen).toBeNull();
  });

  it("dois clientes podem ter o mesmo nome de município sem colidir (achado 3.1 do plano)", async () => {
    await runWithClient(clientA, async () => {
      await prisma.municipality.create({ data: { name: "Pomerode", state: "SC", clientId: -1 } });
    });
    // Antes da Fase 0, isso violaria a unicidade global — agora é permitido.
    await expect(
      runWithClient(clientB, () =>
        prisma.municipality.create({ data: { name: "Pomerode", state: "SC", clientId: -1 } }),
      ),
    ).resolves.toMatchObject({ name: "Pomerode" });
  });

  it("runAsSuperAdmin enxerga os dois clientes juntos, sem filtro", async () => {
    const all = await runAsSuperAdmin(() =>
      prisma.municipality.findMany({ where: { clientId: { in: [clientA, clientB] } } }),
    );
    expect(all.length).toBeGreaterThanOrEqual(3); // Camboriú + Blumenau + Pomerode x2
  });
});
