import type { NextFunction, Request, Response } from "express";
import { prisma } from "@/lib/prisma.js";

// Persistido no Postgres, não em memória: em serverless cada instância teria
// seu próprio Map e o limite não valeria nada assim que duas requisições
// caíssem em instâncias diferentes.
async function checkAndRecordHit(key: string, windowMs: number, maxRequests: number): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMs);
  const count = await prisma.rateLimitHit.count({ where: { key, createdAt: { gt: windowStart } } });
  if (count >= maxRequests) return false;
  await prisma.rateLimitHit.create({ data: { key } });
  // Limpeza oportunista dos acertos vencidos dessa chave, pra tabela não
  // crescer sem limite sem precisar de um cron dedicado.
  await prisma.rateLimitHit.deleteMany({ where: { key, createdAt: { lte: windowStart } } });
  return true;
}

const LOGIN_WINDOW_MS = 5 * 60_000;
const MAX_LOGIN_ATTEMPTS = 10;

export async function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const email = String(req.body?.email || "").toLowerCase();
    const key = `login:${req.ip}:${email}`;
    if (!(await checkAndRecordHit(key, LOGIN_WINDOW_MS, MAX_LOGIN_ATTEMPTS))) {
      return res.status(429).json({ error: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente." });
    }
    next();
  } catch (err) {
    next(err);
  }
}

const RESET_WINDOW_MS = 15 * 60_000;
const MAX_RESET_REQUESTS = 3;

export async function passwordResetRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const key = `reset:${req.ip}`;
    if (!(await checkAndRecordHit(key, RESET_WINDOW_MS, MAX_RESET_REQUESTS))) {
      return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
    }
    next();
  } catch (err) {
    next(err);
  }
}
