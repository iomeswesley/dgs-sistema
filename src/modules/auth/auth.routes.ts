import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma.js";
import { verifyPassword } from "@/lib/auth.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { requireAuth } from "@/middleware/auth.js";
import { loginRateLimiter } from "@/middleware/rateLimiter.js";
import { recordAudit } from "@/modules/audit/audit.service.js";

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
    await recordAudit({ userId: user.id, action: "login", entity: "User", entityId: user.id });

    res.json({ user: req.session.user });
  })
);

authRouter.post(
  "/api/auth/logout",
  asyncHandler(async (req, res) => {
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    res.json({ ok: true });
  })
);

authRouter.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});
