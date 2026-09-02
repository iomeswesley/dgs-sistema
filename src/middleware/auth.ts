import type { NextFunction, Request, Response } from "express";
import "@/middleware/session.js";
import { runWithClient } from "@/lib/tenant-context.js";

// `requireAuth` também abre o contexto de cliente (ver
// src/lib/tenant-context.ts e PLANO-MULTICLIENTE.md seção 4) — junto num
// middleware só, não dois, pra toda rota que já usa `requireAuth` (a
// maioria do sistema) ganhar isolamento automaticamente, sem precisar
// lembrar de adicionar um segundo middleware em cada uma. Rota que
// legitimamente precisa rodar sem cliente nenhum (webhook do WhatsApp, cron)
// não usa `requireAuth` — abre contexto explicitamente por fora (Fase 2).
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  runWithClient(req.session.user.activeClientId, () => next()).catch(next);
}

// Id do usuário logado, pros lançamentos manuais que precisam registrar
// autoria (checks 2 e 3, contato manual, aprovação de lista).
export function currentUserId(req: Request): number {
  const id = req.session?.user?.id;
  if (!id) throw new Error("currentUserId chamado sem sessão — falta requireAuth na rota?");
  return id;
}
