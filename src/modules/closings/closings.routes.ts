import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth } from "@/middleware/auth.js";
import { dateOnlySchema, parseBody, parseDateOnly, parseQuery } from "@/lib/http.js";
import { listClosings, saveClosing } from "./closings.service.js";

export const closingsRouter = Router();
closingsRouter.use("/api/closings", requireAuth);

closingsRouter.get(
  "/api/closings",
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, z.object({ from: dateOnlySchema, to: dateOnlySchema }));
    const rows = await listClosings(
      parseDateOnly(query.from),
      new Date(parseDateOnly(query.to).getTime() + 86_400_000 - 1)
    );
    res.json({ rows });
  })
);

const saveSchema = z.object({
  doctorId: z.number().int().positive(),
  municipalityId: z.number().int().positive(),
  procedureId: z.number().int().positive().nullable(),
  date: dateOnlySchema,
  attendedReported: z.number().int().nonnegative().nullish(),
  paidCount: z.number().int().nonnegative().nullish(),
  extrasCount: z.number().int().nonnegative().optional(),
  notes: z.string().nullish(),
});

closingsRouter.put(
  "/api/closings",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, saveSchema);
    const closing = await saveClosing(
      { ...data, date: parseDateOnly(data.date) },
      currentUserId(req)
    );
    res.json({ closing });
  })
);
