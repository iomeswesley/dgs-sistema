import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma.js";
import { verifyPassword } from "@/lib/auth.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { requireAuth } from "@/middleware/auth.js";
import { loginRateLimiter } from "@/middleware/rateLimiter.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { runWithClient } from "@/lib/tenant-context.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});

authRouter.post(
  "/api/auth/login",
  loginRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError("E-mail e senha são obrigatórios", 400);

    const email = parsed.data.email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });

    // Mesma mensagem para usuário inexistente, senha errada e conta inativa —
    // não confirma pra quem tenta invadir se o e-mail existe.
    const invalid = new AppError("E-mail ou senha inválidos", 401);
    if (!user || !user.active) throw invalid;
    if (!verifyPassword(parsed.data.password, user.passwordHash)) throw invalid;

    // Qual cliente esta sessão vai enxergar (ver src/lib/tenant-context.ts).
    // `UserClient`/`User` não são tabelas isoladas — não precisa de contexto
    // pra ler. Hoje todo mundo tem acesso a exatamente um cliente ("DGS"),
    // então o primeiro já resolve; um seletor de verdade fica pra Fase 3
    // (interface), quando alguém puder ter acesso a mais de um.
    const access = await prisma.userClient.findFirst({ where: { userId: user.id } });
    if (!access) {
      throw new AppError(
        "Usuário sem acesso a nenhum cliente — contate um administrador.",
        403,
      );
    }

    // Renova o id da sessão no login pra evitar session fixation (o atacante
    // não consegue reusar um id que ele mesmo plantou antes da autenticação).
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      activeClientId: access.clientId,
      isSuperAdmin: user.isSuperAdmin,
    };
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    // Sem `requireAuth` aqui (é o próprio login) — nenhum contexto de
    // cliente está aberto ainda nesse ponto. Passar `clientId` explícito
    // pro recordAudit NÃO basta sozinho: a extensão do Prisma
    // (tenant-prisma-extension.ts) exige contexto ativo pra QUALQUER
    // query num modelo isolado, antes mesmo de olhar pro que tem em
    // `data` — sem um `runWithClient` de verdade aqui, `AuditLog.create`
    // lança fail-closed igual quaisquer outro. Achado real, ao vivo
    // contra o deploy de preview: mesmo com `entry.clientId` setado
    // (fix anterior, insuficiente sozinho), TODO login continuava
    // falhando a auditoria em silêncio (recordAudit engole erro de
    // propósito, pra nunca derrubar o login por causa disso).
    await runWithClient(access.clientId, () =>
      recordAudit({ userId: user.id, action: "login", entity: "User", entityId: user.id })
    );

    res.json({ user: req.session.user, clients: await accessibleClients(user.id) });
  })
);

authRouter.post(
  "/api/auth/logout",
  asyncHandler(async (req, res) => {
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    res.json({ ok: true });
  })
);

/** Clientes que o usuário logado pode acessar — base do seletor de cliente
 *  na interface (Fase 3 do plano multi-cliente). Hoje quase sempre devolve
 *  1 item ("DGS"); a tela só mostra o seletor quando vem mais de 1. */
async function accessibleClients(userId: number) {
  const rows = await prisma.userClient.findMany({
    where: { userId },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { client: { name: "asc" } },
  });
  return rows.map((r) => r.client);
}

authRouter.get(
  "/api/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.session.user, clients: await accessibleClients(req.session.user!.id) });
  })
);

const switchClientSchema = z.object({ clientId: z.number().int().positive() });

/**
 * Troca o cliente ativo da sessão — o seletor no topo da interface (Fase 3).
 * Só permite trocar pra um cliente que o `UserClient` do usuário realmente
 * autoriza; nunca aceita um `clientId` arbitrário do corpo da requisição
 * sem checar (isso seria um jeito trivial de ver dado de outro cliente).
 */
authRouter.post(
  "/api/auth/switch-client",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId } = switchClientSchema.parse(req.body);
    const access = await prisma.userClient.findFirst({
      where: { userId: req.session.user!.id, clientId },
    });
    if (!access) throw new AppError("Você não tem acesso a esse cliente.", 403);

    req.session.user!.activeClientId = clientId;
    await recordAudit({
      userId: req.session.user!.id,
      action: "switch_client",
      entity: "User",
      entityId: req.session.user!.id,
      newValue: String(clientId),
    });
    res.json({ user: req.session.user });
  })
);
