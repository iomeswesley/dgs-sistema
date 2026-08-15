import { Router } from "express";
import { waitUntil } from "@vercel/functions";
import { env } from "@/config/env.js";
import { asyncHandler } from "@/middleware/errorHandler.js";
import { parseInboundReplies, parseStatusUpdates, verifyWebhookSignature } from "@/lib/whatsapp.js";
import { handleInboundReply, handleStatusUpdate } from "./whatsapp.service.js";

export const whatsappRouter = Router();

/* Verificação do webhook (a Meta chama uma vez ao cadastrar a URL). */
whatsappRouter.get("/api/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(String(challenge));
  }
  res.sendStatus(403);
});

/*
  Recebimento de eventos.

  Responde 200 o quanto antes: a Meta reentrega o lote inteiro se demorar, e
  reentrega já é tratada por idempotência de wamid. Um erro no processamento
  de um evento não pode derrubar os outros do mesmo lote.
*/
whatsappRouter.post(
  "/api/whatsapp/webhook",
  asyncHandler(async (req, res) => {
    if (!verifyWebhookSignature(req.rawBody, req.get("x-hub-signature-256"))) {
      return res.sendStatus(401);
    }

    res.sendStatus(200);

    // waitUntil: na Vercel a função é congelada logo depois do sendStatus
    // (o 'finish' do response), então sem isso os loops abaixo corriam o
    // risco de ficar pausados no meio — resposta de paciente perdida ou só
    // processada quando outra requisição acordasse a mesma instância.
    waitUntil(processWebhookEvents(req.body));
  })
);

async function processWebhookEvents(body: unknown): Promise<void> {
  // TEMP-DEBUG: remover depois de diagnosticar por que o teste não chegou.
  console.log("[WEBHOOK][DEBUG] payload:", JSON.stringify(body));

  for (const reply of parseInboundReplies(body)) {
    try {
      await handleInboundReply(reply);
    } catch (err) {
      console.error("[WEBHOOK] Falha ao processar resposta:", (err as Error).message);
    }
  }

  for (const update of parseStatusUpdates(body)) {
    try {
      await handleStatusUpdate(update);
    } catch (err) {
      console.error("[WEBHOOK] Falha ao processar status:", (err as Error).message);
    }
  }
}
