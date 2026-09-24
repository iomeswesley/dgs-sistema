import { Router } from "express";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { contactRateLimiter } from "@/middleware/rateLimiter.js";
import { contactLeadSchema, isHoneypotFilled } from "@/modules/leads/leads.schema.js";
import { createContactLead } from "@/modules/leads/leads.service.js";

export const leadsRouter = Router();

leadsRouter.post(
  "/api/public/contact",
  contactRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = contactLeadSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Dados inválidos.", 400);
    // Robô recebe a mesma resposta de sucesso, sem gravar nada.
    if (!isHoneypotFilled(parsed.data)) await createContactLead(parsed.data);
    res.status(201).json({ ok: true });
  })
);
