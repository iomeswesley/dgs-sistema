import type { Request } from "express";
import { z } from "zod";
import { AppError } from "@/middleware/errorHandler.js";

/** Valida o corpo da requisição e devolve os dados tipados, ou lança 400. */
export function parseBody<T extends z.ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join(".");
    throw new AppError(field ? `${field}: ${first?.message}` : (first?.message ?? "Dados inválidos"), 400);
  }
  return result.data;
}

/** Valida a query string. */
export function parseQuery<T extends z.ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message ?? "Parâmetros inválidos", 400);
  }
  return result.data;
}

/** Id numérico de rota (`/api/x/:id`). */
export function routeId(req: Request, param = "id"): number {
  const value = Number(req.params[param]);
  if (!Number.isInteger(value) || value <= 0) throw new AppError("Identificador inválido", 400);
  return value;
}

// UTC explícito, não `new Date(ano, mês, dia)` (fuso local do processo) —
// mesma cautela do achado de 2026-08-26: mesmo quando o resultado batia por
// coincidência (offset de Brasília nunca cruza dia em UTC), depender do fuso
// do processo pra uma coluna @db.Date é o padrão que já causou bug antes.
/** Data YYYY-MM-DD como meia-noite UTC (coluna @db.Date). */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new AppError(`Data inválida: ${value}`, 400);
  return new Date(Date.UTC(year, month - 1, day));
}

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD");
