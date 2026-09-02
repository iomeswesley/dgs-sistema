import type { NextFunction, Request, Response } from "express";
import "@/middleware/session.js";
import { runAsSuperAdmin, runWithClient } from "@/lib/tenant-context.js";

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

// Admin global (Fase 4 do plano multi-cliente) — só quem tem
// `User.isSuperAdmin`. Usa `runAsSuperAdmin` em vez de `runWithClient`
// (que `requireAuth` já abriu) — o escape explícito e nomeado que o plano
// pede (seção 4, item 4): a tela de admin PRECISA enxergar todos os
// clientes, não só o `activeClientId` da sessão de quem está logado.
// Sempre depois de `requireAuth` na cadeia (`router.use(prefix,
// requireAuth, requireSuperAdmin)`), nunca sozinho.
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user?.isSuperAdmin) {
    res.status(403).json({ error: "Só administradores da DGS acessam isso." });
    return;
  }
  runAsSuperAdmin(() => next()).catch(next);
}

// Id do usuário logado, pros lançamentos manuais que precisam registrar
// autoria (checks 2 e 3, contato manual, aprovação de lista).
export function currentUserId(req: Request): number {
  const id = req.session?.user?.id;
  if (!id) throw new Error("currentUserId chamado sem sessão — falta requireAuth na rota?");
  return id;
}
