import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth } from "@/middleware/auth.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";
import { parseBody, parseQuery, routeId } from "@/lib/http.js";
import { generateRandomPassword, hashPassword, verifyPassword } from "@/lib/auth.js";
import { recordAudit } from "@/modules/audit/audit.service.js";

/*
  Equipe e trilha de auditoria.

  A trilha precisa ser LEGÍVEL, não só gravada: como não existem perfis de
  acesso, ela é o único controle sobre quem lançou o quê. Auditoria que
  ninguém consegue consultar não protege nada.
*/

export const teamRouter = Router();
teamRouter.use("/api/team", requireAuth);
teamRouter.use("/api/audit", requireAuth);

/**
 * Ids de usuário com acesso ao cliente ativo. `User` não é isolado por
 * clientId (é global de propósito — uma pessoa pode ter acesso a mais de
 * um cliente, ver PLANO-MULTICLIENTE.md), então a extensão do Prisma
 * NUNCA filtra `prisma.user.*` sozinha — cada rota que opera sobre "a
 * equipe" precisa restringir explicitamente aos usuários do cliente
 * ativo, ou vaza (ou pior, deixa mexer) gente de outro cliente. Achado
 * real pelo usuário em 2026-09-02: revogar o acesso de alguém em Admin
 * não tirava a pessoa da lista de Equipe, porque a lista nunca filtrava
 * por cliente nenhum — listava TODO usuário do sistema inteiro.
 */
async function teamMemberIds(): Promise<number[]> {
  const rows = await prisma.userClient.findMany({
    where: { clientId: requireActiveClientId() },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Confirma que um id é de alguém com acesso ao cliente ativo — usado antes
 *  de editar/redefinir senha/(des)ativar. 404 (não 403): não confirma pra
 *  quem tenta que aquele id existe em outro cliente. */
async function requireTeamMember(id: number): Promise<void> {
  const access = await prisma.userClient.findFirst({ where: { userId: id, clientId: requireActiveClientId() } });
  if (!access) throw new AppError("Usuário não encontrado", 404);
}

teamRouter.get(
  "/api/team",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      where: { id: { in: await teamMemberIds() } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, email: true, active: true, lastLoginAt: true, createdAt: true },
    });
    res.json({ users });
  })
);

const inviteSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  email: z.string().email("E-mail inválido"),
});

/**
 * Cria um membro da equipe com senha aleatória.
 *
 * A senha aparece uma vez só na resposta — quem criou repassa pessoalmente.
 * Não é enviada por e-mail para não depender de um serviço externo estar
 * configurado logo no primeiro acesso.
 */
teamRouter.post(
  "/api/team",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, inviteSchema);
    const email = data.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError("Já existe alguém com esse e-mail.", 409);

    const password = generateRandomPassword(14);
    // Ganha acesso ao mesmo cliente de quem está convidando — sem isso a
    // pessoa nova não conseguiria logar (login exige UserClient, ver
    // auth.routes.ts). Quem precisar de acesso a mais de um cliente
    // recebe pela tela de admin (Fase 4 do plano multi-cliente).
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email,
        passwordHash: hashPassword(password),
        clients: { create: { clientId: requireActiveClientId() } },
      },
      select: { id: true, name: true, email: true, active: true, createdAt: true },
    });

    await recordAudit({
      userId: currentUserId(req),
      action: "create_user",
      entity: "User",
      entityId: user.id,
      newValue: user.email,
    });

    res.status(201).json({ user, password });
  })
);

const editSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  email: z.string().email("E-mail inválido"),
});

/** Edita nome/e-mail de um acesso já existente — não mexe em senha nem em `active`. */
teamRouter.patch(
  "/api/team/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const data = parseBody(req, editSchema);
    const email = data.email.toLowerCase().trim();

    await requireTeamMember(id);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new AppError("Usuário não encontrado", 404);

    if (email !== existing.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email } });
      if (emailTaken) throw new AppError("Já existe alguém com esse e-mail.", 409);
    }

    const user = await prisma.user.update({
      where: { id },
      data: { name: data.name, email },
      select: { id: true, name: true, email: true, active: true, lastLoginAt: true, createdAt: true },
    });

    await recordAudit({
      userId: currentUserId(req),
      action: "edit_user",
      entity: "User",
      entityId: id,
      oldValue: existing.email,
      newValue: user.email,
    });

    res.json({ user });
  })
);

teamRouter.post(
  "/api/team/:id/reset-password",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    await requireTeamMember(id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError("Usuário não encontrado", 404);

    const password = generateRandomPassword(14);
    await prisma.user.update({ where: { id }, data: { passwordHash: hashPassword(password) } });
    await recordAudit({
      userId: currentUserId(req),
      action: "reset_password",
      entity: "User",
      entityId: id,
      newValue: user.email,
    });

    res.json({ password });
  })
);

teamRouter.patch(
  "/api/team/:id/active",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    await requireTeamMember(id);
    const { active } = parseBody(req, z.object({ active: z.boolean() }));

    if (!active && id === currentUserId(req)) {
      throw new AppError("Você não pode desativar a própria conta.", 400);
    }
    if (!active) {
      // Um cliente sem ninguém ativo fica inacessível pra ele e só volta
      // por script — a contagem é só da equipe DESTE cliente, não do
      // sistema inteiro (senão o cliente B nunca travaria essa proteção
      // só porque o cliente A tem gente ativa sobrando).
      const memberIds = await teamMemberIds();
      const activeCount = await prisma.user.count({ where: { id: { in: memberIds }, active: true } });
      if (activeCount <= 1) throw new AppError("Precisa sobrar pelo menos uma conta ativa.", 400);
    }

    const user = await prisma.user.update({
      where: { id },
      data: { active },
      select: { id: true, name: true, email: true, active: true },
    });
    await recordAudit({
      userId: currentUserId(req),
      action: active ? "activate_user" : "deactivate_user",
      entity: "User",
      entityId: id,
      newValue: user.email,
    });

    res.json({ user });
  })
);

/**
 * Exclui a pessoa da equipe deste cliente — diferente de desativar
 * (`PATCH .../active`), que só pausa reversível mantendo a pessoa visível
 * na lista como inativa. Excluir tira o vínculo (`UserClient`) com o
 * cliente ativo por completo; ela some da lista. A conta (`User`) e todo
 * o histórico dela (auditoria, listas que aprovou, contatos que fez etc.)
 * continuam existindo — só o acesso a ESTE cliente é removido. Se for o
 * único cliente que a pessoa tinha, ela deixa de conseguir logar em
 * qualquer lugar, mas a conta em si não é apagada (pedido explícito do
 * usuário: "excluir", não só "desativar" — diferente do endpoint
 * equivalente em admin.routes.ts, que bloqueia esse caso e sugere
 * desativar; aqui é decisão deliberada de permitir).
 */
teamRouter.delete(
  "/api/team/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    await requireTeamMember(id);
    if (id === currentUserId(req)) {
      throw new AppError("Você não pode excluir a própria conta.", 400);
    }

    const user = await prisma.user.findUnique({ where: { id }, select: { email: true } });
    await prisma.userClient.deleteMany({ where: { userId: id, clientId: requireActiveClientId() } });

    await recordAudit({
      userId: currentUserId(req),
      action: "remove_team_member",
      entity: "User",
      entityId: id,
      newValue: user?.email ?? null,
    });

    res.json({ ok: true });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "A nova senha precisa de pelo menos 8 caracteres"),
});

/** Troca da própria senha, exigindo a atual. */
teamRouter.post(
  "/api/team/me/password",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, changePasswordSchema);
    const id = currentUserId(req);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError("Usuário não encontrado", 404);

    if (!verifyPassword(data.currentPassword, user.passwordHash)) {
      throw new AppError("Senha atual incorreta.", 401);
    }

    await prisma.user.update({ where: { id }, data: { passwordHash: hashPassword(data.newPassword) } });
    await recordAudit({ userId: id, action: "change_own_password", entity: "User", entityId: id });

    res.json({ ok: true });
  })
);

/* ---------------- Trilha de auditoria ---------------- */

teamRouter.get(
  "/api/audit",
  asyncHandler(async (req, res) => {
    const query = parseQuery(
      req,
      z.object({
        entity: z.string().optional(),
        entityId: z.coerce.number().int().positive().optional(),
        userId: z.coerce.number().int().positive().optional(),
        action: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
    );

    const logs = await prisma.auditLog.findMany({
      where: {
        entity: query.entity,
        entityId: query.entityId,
        userId: query.userId,
        action: query.action,
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
      include: { user: { select: { id: true, name: true } } },
    });

    res.json({ logs });
  })
);
