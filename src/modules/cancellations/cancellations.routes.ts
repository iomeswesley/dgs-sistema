import { Router } from "express";
import { z } from "zod";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth } from "@/middleware/auth.js";
import { parseBody, routeId } from "@/lib/http.js";
import {
  dispatchCancellation,
  getCancellationBatch,
  listCancellationBatches,
  previewCancellation,
  type CancellationSource,
} from "./cancellations.service.js";

export const cancellationsRouter = Router();
cancellationsRouter.use("/api/cancellations", requireAuth);

cancellationsRouter.get(
  "/api/cancellations",
  asyncHandler(async (_req, res) => {
    res.json({ batches: await listCancellationBatches() });
  })
);

/** Lê `agendaId` ou `listId` da query/body — exatamente um dos dois. */
function parseSource(input: { agendaId?: unknown; listId?: unknown }): CancellationSource {
  const agendaId = input.agendaId != null ? Number(input.agendaId) : null;
  const listId = input.listId != null ? Number(input.listId) : null;
  if (agendaId && Number.isInteger(agendaId)) return { agendaId };
  if (listId && Number.isInteger(listId)) return { listId };
  throw new AppError("Informe agendaId ou listId.", 400);
}

cancellationsRouter.get(
  "/api/cancellations/preview",
  asyncHandler(async (req, res) => {
    const source = parseSource(req.query as { agendaId?: unknown; listId?: unknown });
    res.json(await previewCancellation(source));
  })
);

cancellationsRouter.get(
  "/api/cancellations/:id",
  asyncHandler(async (req, res) => {
    res.json(await getCancellationBatch(routeId(req)));
  })
);

const dispatchSchema = z.object({
  agendaId: z.number().int().positive().optional(),
  listId: z.number().int().positive().optional(),
  reason: z.string().trim().min(1, "Descreva o motivo").max(500),
});

cancellationsRouter.post(
  "/api/cancellations",
  asyncHandler(async (req, res) => {
    const { agendaId, listId, reason } = parseBody(req, dispatchSchema);
    const source = parseSource({ agendaId, listId });
    const result = await dispatchCancellation(source, reason, currentUserId(req));
    res.status(201).json(result);
  })
);
