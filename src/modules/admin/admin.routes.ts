/*
  Admin global (Fase 4 do PLANO-MULTICLIENTE.md) — só `User.isSuperAdmin`.

  Visão de todos os clientes, criar cliente novo, conceder/revogar acesso
  de usuário. Roda inteiro dentro de `runAsSuperAdmin` (ver
  `requireSuperAdmin`, middleware/auth.ts) — o único lugar do sistema onde
  isso é esperado; em qualquer outra rota seria um vazamento entre
  clientes.
*/
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth, requireSuperAdmin } from "@/middleware/auth.js";
import { parseBody, routeId } from "@/lib/http.js";
import { recordAudit } from "@/modules/audit/audit.service.js";

export const adminRouter = Router();
adminRouter.use("/api/admin", requireAuth, requireSuperAdmin);

/** Lista todos os clientes com contagens básicas — visão geral da Fase 4. */
adminRouter.get(
  "/api/admin/clients",
  asyncHandler(async (_req, res) => {
    const clients = await prisma.client.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { municipalities: true, patients: true, appointments: true, users: true },
        },
      },
    });
    res.json({ clients });
  })
);

const createClientSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  notes: z.string().optional(),
});

/**
 * Cria um cliente novo. Só a DGS cria cliente (não é self-service, ver
 * PLANO-MULTICLIENTE.md seção 1 — "fora de escopo de propósito").
 */
adminRouter.post(
  "/api/admin/clients",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, createClientSchema);
    const existing = await prisma.client.findUnique({ where: { name: data.name } });
    if (existing) throw new AppError("Já existe um cliente com esse nome.", 409);

    // AppSettings é uma linha por cliente (Fase 0 do plano multi-cliente) —
    // sem criar já aqui, a primeira leitura de Configurações desse cliente
    // (e o cron, que consulta pra decidir a retenção de mídia) quebra com
    // "Configurações do sistema não encontradas" (achado real testando
    // esta mesma Fase 4, ver settings.service.ts).
    const client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({ data: { name: data.name, notes: data.notes ?? null } });
      await tx.appSettings.create({ data: { clientId: created.id } });
      return created;
    });
    await recordAudit({
      clientId: client.id,
      userId: currentUserId(req),
      action: "admin.create_client",
      entity: "Client",
      entityId: client.id,
      newValue: client.name,
    });
    res.status(201).json({ client });
  })
);

const editClientSchema = z.object({
  name: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

adminRouter.patch(
  "/api/admin/clients/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const data = parseBody(req, editClientSchema);
    const before = await prisma.client.findUnique({ where: { id } });
    if (!before) throw new AppError("Cliente não encontrado.", 404);

    const client = await prisma.client.update({ where: { id }, data });
    await recordAudit({
      clientId: id,
      userId: currentUserId(req),
      action: "admin.edit_client",
      entity: "Client",
      entityId: id,
      oldValue: JSON.stringify(before),
      newValue: JSON.stringify(client),
    });
    res.json({ client });
  })
);

/** Usuários com acesso a um cliente. */
adminRouter.get(
  "/api/admin/clients/:id/users",
  asyncHandler(async (req, res) => {
    const clientId = routeId(req);
    const rows = await prisma.userClient.findMany({
      where: { clientId },
      include: { user: { select: { id: true, name: true, email: true, active: true, isSuperAdmin: true } } },
      orderBy: { user: { name: "asc" } },
    });
    res.json({ users: rows.map((r) => r.user) });
  })
);

const grantAccessSchema = z.object({ email: z.string().email("E-mail inválido") });

/** Concede acesso de um usuário já existente a um cliente (não cria usuário — isso é a Equipe). */
adminRouter.post(
  "/api/admin/clients/:id/users",
  asyncHandler(async (req, res) => {
    const clientId = routeId(req);
    const { email } = parseBody(req, grantAccessSchema);
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new AppError("Cliente não encontrado.", 404);

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) throw new AppError("Não existe usuário com esse e-mail — crie o acesso primeiro em Equipe.", 404);

    const existing = await prisma.userClient.findFirst({ where: { userId: user.id, clientId } });
    if (existing) throw new AppError("Esse usuário já tem acesso a esse cliente.", 409);

    await prisma.userClient.create({ data: { userId: user.id, clientId } });
    await recordAudit({
      clientId,
      userId: currentUserId(req),
      action: "admin.grant_client_access",
      entity: "UserClient",
      metadata: { userId: user.id, email: user.email, clientId, clientName: client.name },
    });
    res.status(201).json({ ok: true });
  })
);

/**
 * Revoga acesso de um usuário a um cliente. Bloqueia se for o único
 * cliente que sobra pra essa pessoa — ninguém pode ficar sem acesso a
 * cliente nenhum (o login exige, ver auth.routes.ts), e revogar o último
 * de propósito é uma decisão que passa por desativar o usuário inteiro
 * (Equipe), não por aqui.
 */
adminRouter.delete(
  "/api/admin/clients/:id/users/:userId",
  asyncHandler(async (req, res) => {
    const clientId = routeId(req);
    const userId = routeId(req, "userId");

    const accessCount = await prisma.userClient.count({ where: { userId } });
    if (accessCount <= 1) {
      throw new AppError(
        "Esse é o único cliente desse usuário — revogar deixaria a pessoa sem conseguir logar. Desative o acesso em Equipe se for o caso.",
        409
      );
    }

    const removed = await prisma.userClient.deleteMany({ where: { userId, clientId } });
    if (removed.count === 0) throw new AppError("Esse usuário não tinha acesso a esse cliente.", 404);

    await recordAudit({
      clientId,
      userId: currentUserId(req),
      action: "admin.revoke_client_access",
      entity: "UserClient",
      metadata: { userId, clientId },
    });
    res.json({ ok: true });
  })
);
