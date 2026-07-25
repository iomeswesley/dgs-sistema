import type { NextFunction, Request, Response } from "express";
import { captureError, flushErrorReporting } from "@/lib/errorReporting.js";

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// As rotas lançam AppError e deixam o Express cair aqui, em vez de repetir
// try/catch com status hardcoded em cada handler. Só erro inesperado vai pro
// Sentry — AppError é validação normal, não bug.
export async function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  captureError(err);
  await flushErrorReporting();
  res.status(500).json({ error: "Erro interno do servidor" });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Rota não encontrada" });
}

// Envolve handlers async pra que uma promise rejeitada chegue no
// errorHandler em vez de derrubar o processo (Express 4 não faz isso sozinho).
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: T, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
