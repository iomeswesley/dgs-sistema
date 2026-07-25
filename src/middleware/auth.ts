import type { NextFunction, Request, Response } from "express";
import "@/middleware/session.js";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  next();
}

// Id do usuário logado, pros lançamentos manuais que precisam registrar
// autoria (checks 2 e 3, contato manual, aprovação de lista).
export function currentUserId(req: Request): number {
  const id = req.session?.user?.id;
  if (!id) throw new Error("currentUserId chamado sem sessão — falta requireAuth na rota?");
  return id;
}
