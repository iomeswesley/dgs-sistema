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
} from "./cancellations.service.js";

export const cancellationsRouter = Router();
cancellationsRouter.use("/api/cancellations", requireAuth);

cancellationsRouter.get(
  "/api/cancellations",
  asyncHandler(async (_req, res) => {
    res.json({ batches: await listCancellationBatches() });
  })
);

cancellationsRouter.get(
  "/api/cancellations/preview",
  asyncHandler(async (req, res) => {
    const agendaId = Number(req.query.agendaId);
    if (!Number.isInteger(agendaId)) throw new AppError("agendaId inválido.", 400);
    res.json(await previewCancellation(agendaId));
  })
);

cancellationsRouter.get(
  "/api/cancellations/:id",
  asyncHandler(async (req, res) => {
    res.json(await getCancellationBatch(routeId(req)));
  })
);

const dispatchSchema = z.object({
  agendaId: z.number().int().positive(),
  reason: z.string().trim().min(1, "Descreva o motivo").max(500),
});

cancellationsRouter.post(
  "/api/cancellations",
  asyncHandler(async (req, res) => {
    const { agendaId, reason } = parseBody(req, dispatchSchema);
    const result = await dispatchCancellation(agendaId, reason, currentUserId(req));
    res.status(201).json(result);
  })
);
