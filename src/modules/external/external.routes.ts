import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler, AppError } from "@/middleware/errorHandler.js";
import { requireAuth, currentUserId } from "@/middleware/auth.js";
import { dateOnlySchema, parseBody, parseDateOnly, parseQuery, routeId } from "@/lib/http.js";
import { toBrasiliaDateString } from "@/lib/timezone.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";
import { prisma } from "@/lib/prisma.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { generateApiToken } from "./api-token.js";
import { requireApiToken } from "./external-auth.js";
import { daySpan } from "./external.js";
import {
  getActivitySummary,
  getAppointmentsByConsultationDate,
  getIndicatorsSummary,
  getListsSummary,
} from "./external.service.js";
import { buildOpenApiSpec } from "./openapi.js";

/*
  API externa só de leitura, pra o GPT do ChatGPT do dono da DGS (pedido de
  2026-11-11). Duas partes:

  1. `/api/externo/*` — autenticada por token (`requireApiToken`), só
     números agregados. `/api/externo/openapi.json` é público (só descreve
     a API, não tem dado nenhum) pra o ChatGPT importar na configuração da
     "Action" do GPT.
  2. `/api/integracoes/tokens` — tela de Equipe (sessão normal): criar,
     listar e revogar tokens do cliente ativo.
*/

export const externalRouter = Router();

externalRouter.get("/api/externo/openapi.json", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.json(buildOpenApiSpec(`${req.protocol}://${req.get("host")}`));
});

externalRouter.use("/api/externo", requireApiToken);

// `toBrasiliaDateString`, não `localDateString` (fuso do processo — já
// errou o dia na Vercel antes, ver CLAUDE.md 2026-09-11).
function today(): string {
  return toBrasiliaDateString(new Date());
}

function addDays(day: string, delta: number): string {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + delta));
  return d.toISOString().slice(0, 10);
}

const rangeSchema = z.object({ de: dateOnlySchema.optional(), ate: dateOnlySchema.optional() });

function resolveRange(req: Request, defaults: { de: string; ate: string }, maxDays: number) {
  const q = parseQuery(req, rangeSchema);
  const de = q.de ?? defaults.de;
  const ate = q.ate ?? defaults.ate;
  const span = daySpan(de, ate);
  if (span < 1) throw new AppError("'de' precisa ser antes ou igual a 'ate'.", 400);
  if (span > maxDays) throw new AppError(`Intervalo grande demais: no máximo ${maxDays} dias.`, 400);
  return { de, ate };
}

externalRouter.get(
  "/api/externo/resumo",
  asyncHandler(async (req, res) => {
    const { de, ate } = resolveRange(req, { de: today(), ate: today() }, 62);
    res.json(await getActivitySummary(de, ate));
  })
);

externalRouter.get(
  "/api/externo/agendamentos",
  asyncHandler(async (req, res) => {
    const { de, ate } = resolveRange(req, { de: today(), ate: addDays(today(), 1) }, 62);
    res.json(await getAppointmentsByConsultationDate(de, ate));
  })
);

externalRouter.get(
  "/api/externo/listas",
  asyncHandler(async (req, res) => {
    const { de, ate } = resolveRange(req, { de: addDays(today(), -6), ate: today() }, 62);
    res.json(await getListsSummary(de, ate));
  })
);

const indicatorsSchema = rangeSchema.extend({
  agrupar: z.enum(["medico", "municipio", "procedimento", "mes"]).default("medico"),
});

externalRouter.get(
  "/api/externo/indicadores",
  asyncHandler(async (req, res) => {
    const { de, ate } = resolveRange(req, { de: addDays(today(), -29), ate: today() }, 366);
    const { agrupar } = parseQuery(req, indicatorsSchema);
    // Mesmo recorte de datas da tela Indicadores (indicators.routes.ts),
    // pra os números baterem com o que a equipe vê.
    const from = parseDateOnly(de);
    const to = new Date(parseDateOnly(ate).getTime() + 86_400_000 - 1);
    res.json({ periodo: { de, ate }, ...(await getIndicatorsSummary(from, to, agrupar)) });
  })
);

/* ---------------- Gestão dos tokens (tela de Equipe) ---------------- */

externalRouter.use("/api/integracoes", requireAuth);

externalRouter.get(
  "/api/integracoes/tokens",
  asyncHandler(async (_req, res) => {
    const tokens = await prisma.apiToken.findMany({
      orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdBy: { select: { name: true } },
      },
    });
    const usage = await prisma.auditLog.groupBy({
      by: ["entityId"],
      where: { action: "api_external_read", entity: "ApiToken", entityId: { in: tokens.map((t) => t.id) } },
      _count: { _all: true },
    });
    const countById = new Map(usage.map((u) => [u.entityId, u._count._all]));
    res.json({ tokens: tokens.map((t) => ({ ...t, consultas: countById.get(t.id) ?? 0 })) });
  })
);

const createTokenSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome pro token (ex.: ChatGPT do Lucas)").max(80, "Nome longo demais"),
});

externalRouter.post(
  "/api/integracoes/tokens",
  asyncHandler(async (req, res) => {
    const { name } = parseBody(req, createTokenSchema);
    const userId = currentUserId(req);
    const { token, hash, displayPrefix } = generateApiToken();
    const created = await prisma.apiToken.create({
      data: { name, tokenHash: hash, tokenPrefix: displayPrefix, createdById: userId, clientId: requireActiveClientId() },
      select: { id: true, name: true, tokenPrefix: true, createdAt: true },
    });
    await recordAudit({ userId, action: "create_api_token", entity: "ApiToken", entityId: created.id, newValue: name });
    // O token aparece só nesta resposta — no banco fica só o hash.
    res.status(201).json({ token: created, secret: token });
  })
);

externalRouter.delete(
  "/api/integracoes/tokens/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const userId = currentUserId(req);
    const existing = await prisma.apiToken.findUnique({ where: { id }, select: { id: true, name: true, revokedAt: true } });
    if (!existing) throw new AppError("Token não encontrado", 404);
    if (!existing.revokedAt) {
      await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
      await recordAudit({ userId, action: "revoke_api_token", entity: "ApiToken", entityId: id, oldValue: existing.name });
    }
    res.json({ ok: true });
  })
);
