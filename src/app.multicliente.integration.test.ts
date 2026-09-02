// Teste de integração HTTP com 2 clientes de verdade — PLANO-MULTICLIENTE.md
// seção 6 ("Teste automatizado com 2 clientes provando que a query de um
// nunca vê o outro") e seção 8 ("nenhum teste cobre a cadeia HTTP completa
// requireAuth → rota → service"). Diferente de
// `lib/tenant-isolation.integration.test.ts` (que exercita a extensão
// diretamente), este sobe o Express de verdade (`createApp()`) e faz
// requisições HTTP reais via `supertest` — login, sessão, cookie, tudo.
//
// Só roda contra o banco de TESTE (nunca produção) — mesmas 3 camadas de
// segurança do outro teste de integração: lê só `.env.multicliente` do
// disco (nunca `process.env` já existente), pula a suíte inteira se esse
// arquivo não existir, e recusa rodar se a connection string apontar pro
// projeto de produção.
//
// Cuidado extra aqui, específico deste arquivo: `src/config/env.ts` faz
// `process.exit(1)` se DATABASE_URL/DIRECT_URL/SESSION_SECRET não
// estiverem em `process.env` NO MOMENTO em que o módulo é importado — e
// isso aconteceria de novo (matando o worker do vitest inteiro, não só
// este arquivo) se `@/app.js` fosse importado estaticamente no topo. Por
// isso o import é DINÂMICO (`await import(...)`), feito só dentro de
// `beforeAll`, depois de já ter validado o arquivo/projeto e setado
// `process.env` — nunca no escopo do módulo.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "@/lib/auth.js";
import { runAsSuperAdmin } from "@/lib/tenant-context.js";

const ENV_FILE = path.resolve(__dirname, "../.env.multicliente");
const TEST_PROJECT_REF = "qiacbjpsjkkeeaaflmum";
const PRODUCTION_PROJECT_REF = "koplspjaqazgsvcaspmp";

function readEnvVar(content: string, name: string): string | null {
  const match = content.match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m"));
  return match?.[1] ?? null;
}

const envFileExists = existsSync(ENV_FILE);

describe.skipIf(!envFileExists)("HTTP multi-cliente (banco de teste real, Express de verdade)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let clientA: { id: number };
  let clientB: { id: number };
  let userA: { id: number; email: string };
  let userB: { id: number; email: string };
  const PASSWORD = "senha-de-teste-nao-usar-em-producao";
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    const content = readFileSync(ENV_FILE, "utf-8");
    const databaseUrl = readEnvVar(content, "DATABASE_URL");
    const directUrl = readEnvVar(content, "DIRECT_URL");
    if (!databaseUrl || !directUrl) {
      throw new Error(".env.multicliente sem DATABASE_URL/DIRECT_URL — arquivo incompleto.");
    }
    if (databaseUrl.includes(PRODUCTION_PROJECT_REF) || directUrl.includes(PRODUCTION_PROJECT_REF)) {
      throw new Error("SEGURANÇA: .env.multicliente aponta pro projeto de PRODUÇÃO — recusando rodar.");
    }
    if (!databaseUrl.includes(TEST_PROJECT_REF)) {
      throw new Error(`SEGURANÇA: .env.multicliente não aponta pro projeto de teste esperado (${TEST_PROJECT_REF}).`);
    }

    // Guarda o que já existia (deve ser nada, mas não custa) pra restaurar
    // no afterAll — process.env é global do worker, outros arquivos de
    // teste no mesmo worker não devem herdar isso depois deste arquivo.
    for (const key of ["DATABASE_URL", "DIRECT_URL", "SESSION_SECRET"]) {
      savedEnv[key] = process.env[key];
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.DIRECT_URL = directUrl;
    process.env.SESSION_SECRET = "sessao-de-teste-" + Date.now();

    // Import dinâmico — só agora, com process.env já pronto (ver comentário
    // grande no topo do arquivo).
    const [{ createApp }, { prisma: prismaClient }] = await Promise.all([
      import("@/app.js"),
      import("@/lib/prisma.js"),
    ]);
    prisma = prismaClient;
    app = createApp();

    clientA = await prisma.client.create({ data: { name: `__http_teste_A_${Date.now()}` } });
    clientB = await prisma.client.create({ data: { name: `__http_teste_B_${Date.now()}` } });
    await runAsSuperAdmin(async () => {
      await prisma.appSettings.create({ data: { clientId: clientA.id } });
      await prisma.appSettings.create({ data: { clientId: clientB.id } });
    });

    const emailA = `__teste_a_${Date.now()}@dgs.local`;
    const emailB = `__teste_b_${Date.now()}@dgs.local`;
    userA = await prisma.user.create({
      data: {
        name: "Teste A",
        email: emailA,
        passwordHash: hashPassword(PASSWORD),
        clients: { create: { clientId: clientA.id } },
      },
    });
    userB = await prisma.user.create({
      data: {
        name: "Teste B",
        email: emailB,
        passwordHash: hashPassword(PASSWORD),
        clients: { create: { clientId: clientB.id } },
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return; // beforeAll pode não ter rodado (suíte pulada)
    await prisma.userClient.deleteMany({ where: { clientId: { in: [clientA.id, clientB.id] } } });
    await runAsSuperAdmin(async () => {
      await prisma.municipality.deleteMany({ where: { clientId: { in: [clientA.id, clientB.id] } } });
      await prisma.appSettings.deleteMany({ where: { clientId: { in: [clientA.id, clientB.id] } } });
      await prisma.auditLog.deleteMany({ where: { clientId: { in: [clientA.id, clientB.id] } } });
    });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientA.id, clientB.id] } } });
    await prisma.$disconnect();

    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("cada usuário nunca vê o município criado pelo outro cliente, via HTTP de verdade", async () => {
    const supertest = (await import("supertest")).default;
    const agentA = supertest.agent(app);
    const agentB = supertest.agent(app);

    const loginA = await agentA.post("/api/auth/login").send({ email: userA.email, password: PASSWORD });
    expect(loginA.status).toBe(200);
    expect(loginA.body.user.activeClientId).toBe(clientA.id);

    const loginB = await agentB.post("/api/auth/login").send({ email: userB.email, password: PASSWORD });
    expect(loginB.status).toBe(200);
    expect(loginB.body.user.activeClientId).toBe(clientB.id);

    // Login grava auditoria — achado real nesta mesma sessão: recordAudit()
    // engole erro em silêncio, então um 200 no login sozinho não prova que
    // a trilha foi gravada (já aconteceu de não ser, sem ninguém notar).
    const auditA = await runAsSuperAdmin(() =>
      prisma.auditLog.findFirst({ where: { userId: userA.id, action: "login" } })
    );
    expect(auditA).not.toBeNull();
    expect(auditA.clientId).toBe(clientA.id);

    const createA = await agentA
      .post("/api/catalog/municipalities")
      .send({ name: "Cidade Só de A", state: "SC" });
    expect(createA.status).toBe(201);
    const municipalityAId: number = createA.body.municipality.id;

    const createB = await agentB
      .post("/api/catalog/municipalities")
      .send({ name: "Cidade Só de B", state: "SC" });
    expect(createB.status).toBe(201);
    const municipalityBId: number = createB.body.municipality.id;

    const listAsA = await agentA.get("/api/catalog/municipalities");
    expect(listAsA.body.municipalities.map((m: { name: string }) => m.name)).toEqual(["Cidade Só de A"]);

    const listAsB = await agentB.get("/api/catalog/municipalities");
    expect(listAsB.body.municipalities.map((m: { name: string }) => m.name)).toEqual(["Cidade Só de B"]);

    // B tentando editar o município de A pelo id, direto — precisa dar 404
    // (a query com clientId injetado nem encontra a linha), nunca 200.
    const crossPatch = await agentB
      .patch(`/api/catalog/municipalities/${municipalityAId}`)
      .send({ name: "Tentativa de B editar A" });
    expect(crossPatch.status).toBe(404);

    // Confirma que A não foi alterado.
    const stillA = await agentA.get("/api/catalog/municipalities");
    expect(stillA.body.municipalities[0].name).toBe("Cidade Só de A");

    // A sem sessão nenhuma (sem cookie) — bloqueado antes de chegar em
    // qualquer query.
    const anonymous = await supertest(app).get("/api/catalog/municipalities");
    expect(anonymous.status).toBe(401);

    // Referência só pra typescript não reclamar de variável não usada.
    expect(municipalityBId).toBeGreaterThan(0);
  }, 20_000); // várias requisições HTTP reais + banco remoto — folga do default de 5s
});
