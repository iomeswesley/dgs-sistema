import type { NextFunction, Request, Response } from "express";
import { prisma } from "@/lib/prisma.js";
import { runAsSuperAdmin, runWithClient } from "@/lib/tenant-context.js";
import { externalApiAllowed } from "@/middleware/rateLimiter.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { extractBearerToken, hashApiToken } from "./api-token.js";

/*
  Autenticação da API externa por token (`Authorization: Bearer rgl_...`),
  sem sessão/cookie — o ChatGPT chama de servidor pra servidor.

  - Busca o token pelo hash dentro de `runAsSuperAdmin` (ainda não se sabe
    o cliente; `ApiToken` é modelo isolado), depois abre `runWithClient` no
    cliente do token — daí pra frente o isolamento é o de sempre.
  - Token revogado ou cliente desativado = 401, mesma mensagem genérica
    (não confirma pra quem testa se o token existiu).
  - Cada consulta vira uma linha na auditoria (Equipe → Últimos lançamentos).
*/

declare module "express-serve-static-core" {
  interface Request {
    apiToken?: { id: number; clientId: number; name: string };
  }
}

const UNAUTHORIZED = { error: "Token inválido ou revogado. Gere um novo em Equipe → Integração com ChatGPT." };

export function requireApiToken(req: Request, res: Response, next: NextFunction) {
  (async () => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json(UNAUTHORIZED);

    const record = await runAsSuperAdmin(() =>
      prisma.apiToken.findUnique({
        where: { tokenHash: hashApiToken(token) },
        select: { id: true, clientId: true, name: true, revokedAt: true, client: { select: { active: true } } },
      })
    );
    if (!record || record.revokedAt || !record.client.active) return res.status(401).json(UNAUTHORIZED);

    if (!(await externalApiAllowed(record.id))) {
      return res.status(429).json({ error: "Muitas consultas nesta hora. Tente de novo daqui a pouco." });
    }

    req.apiToken = { id: record.id, clientId: record.clientId, name: record.name };
    await runWithClient(record.clientId, async () => {
      await prisma.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
      await recordAudit({
        userId: null,
        action: "api_external_read",
        entity: "ApiToken",
        entityId: record.id,
        metadata: { path: req.path, query: req.query as Record<string, unknown> },
      });
      next();
    });
  })().catch(next);
}
