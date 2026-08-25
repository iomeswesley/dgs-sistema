import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/errorHandler.js";
import { requireAuth } from "@/middleware/auth.js";
import { parseBody } from "@/lib/http.js";
import { getSettings, updateSettings } from "./settings.service.js";

export const settingsRouter = Router();
settingsRouter.use("/api/settings", requireAuth);

settingsRouter.get(
  "/api/settings",
  asyncHandler(async (_req, res) => {
    res.json(await getSettings());
  })
);

const updateSchema = z.object({
  mediaRetentionDays: z.number().int().min(1).max(365).optional(),
});

settingsRouter.patch(
  "/api/settings",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, updateSchema);
    res.json(await updateSettings(data));
  })
);
