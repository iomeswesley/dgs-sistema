import { Router } from "express";
import { z } from "zod";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { requireAuth } from "@/middleware/auth.js";
import { parseBody } from "@/lib/http.js";
import { getThread, listConversations, sendReply } from "./conversations.service.js";

export const conversationsRouter = Router();
conversationsRouter.use("/api/conversations", requireAuth);

conversationsRouter.get(
  "/api/conversations",
  asyncHandler(async (_req, res) => {
    res.json({ conversations: await listConversations() });
  })
);

function routePhone(req: { params: Record<string, string | undefined> }): string {
  const phone = req.params.phone;
  if (!phone) throw new AppError("Telefone não informado.", 400);
  return phone;
}

conversationsRouter.get(
  "/api/conversations/:phone/messages",
  asyncHandler(async (req, res) => {
    const thread = await getThread(routePhone(req));
    res.json(thread);
  })
);

const replySchema = z.object({ text: z.string().trim().min(1, "Mensagem vazia").max(4096) });

conversationsRouter.post(
  "/api/conversations/:phone/messages",
  asyncHandler(async (req, res) => {
    const { text } = parseBody(req, replySchema);
    const phone = routePhone(req);
    await sendReply(phone, text);
    const thread = await getThread(phone);
    res.status(201).json(thread);
  })
);
