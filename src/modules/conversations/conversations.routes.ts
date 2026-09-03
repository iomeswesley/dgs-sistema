import { Router } from "express";
import { z } from "zod";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { requireAuth } from "@/middleware/auth.js";
import { parseBody, routeId } from "@/lib/http.js";
import { TEMPLATE_FIELDS } from "@/lib/templates.js";
import { getMessageMedia, getThread, listConversations, sendReply, sendTemplateReply } from "./conversations.service.js";

export const conversationsRouter = Router();
conversationsRouter.use("/api/conversations", requireAuth);

conversationsRouter.get(
  "/api/conversations",
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    res.json({ conversations: await listConversations(200, search) });
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

/**
 * Serve a mídia baixada de uma mensagem (imagem, áudio, figurinha,
 * documento) — nunca inline na lista de mensagens (custo de banda), só sob
 * demanda quando a tela pede. 404 quando nunca teve mídia, o download
 * falhou na hora (best-effort, ver `whatsapp.service.ts`) ou já passou da
 * retenção configurável e foi expurgada (`purgeExpiredMedia`).
 */
conversationsRouter.get(
  "/api/conversations/:phone/messages/:messageId/media",
  asyncHandler(async (req, res) => {
    const media = await getMessageMedia(routePhone(req), routeId(req, "messageId"));
    if (!media) throw new AppError("Mídia não encontrada (ou já expurgada).", 404);
    res.setHeader("Content-Type", media.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(media.filename ?? "arquivo")}"`);
    res.send(media.data);
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

/** Campos de cada template — a tela usa isso pra montar o formulário certo antes de mandar. */
conversationsRouter.get(
  "/api/conversations/template-fields",
  asyncHandler(async (_req, res) => {
    res.json({ fields: TEMPLATE_FIELDS });
  })
);

// Faltava CANCELAMENTO aqui (achado em 2026-08-26) — o frontend já oferecia
// a opção em Conversas, mas o backend rejeitava com erro de validação.
const templateSchema = z.object({
  template: z.enum(["CONFIRMACAO", "LEMBRETE", "VAGA_ABERTA", "CANCELAMENTO"]),
  header: z.array(z.string()).optional(),
  body: z.array(z.string().min(1, "Preencha todos os campos do template")),
});

/**
 * Manda template — funciona a qualquer momento (é a única forma de
 * reabrir a conversa fora da janela de 24h). Diferente do texto livre,
 * não bloqueia se a última mensagem for antiga.
 */
conversationsRouter.post(
  "/api/conversations/:phone/template",
  asyncHandler(async (req, res) => {
    const { template, header, body } = parseBody(req, templateSchema);
    const phone = routePhone(req);
    try {
      await sendTemplateReply(phone, template, { header, body });
    } catch (err) {
      throw new AppError((err as Error).message, 502);
    }
    const thread = await getThread(phone);
    res.status(201).json(thread);
  })
);
