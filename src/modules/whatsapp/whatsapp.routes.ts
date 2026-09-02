import { Router } from "express";
import { waitUntil } from "@vercel/functions";
import { env } from "@/config/env.js";
import { asyncHandler } from "@/middleware/errorHandler.js";
import { parseInboundReplies, parseStatusUpdates, verifyWebhookSignature } from "@/lib/whatsapp.js";
import { runWithClient } from "@/lib/tenant-context.js";
import { resolveClientIdByPhoneNumberId } from "./whatsapp-account.service.js";
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

/**
 * Roteamento por cliente (achado 3.2 do PLANO-MULTICLIENTE.md, Fase 2): a
 * DGS é um Provedor de Tecnologia com um app só pra todos os clientes — o
 * webhook recebe eventos de QUALQUER WABA inscrita nele, então cada evento
 * é resolvido pelo `phone_number_id` que RECEBEU a mensagem, nunca por um
 * cliente "padrão". Sem cliente resolvido, o evento é registrado e
 * ignorado — nunca processado contra o banco inteiro (fail-closed também
 * aqui, não só dentro do Prisma).
 */
async function processWebhookEvents(body: unknown): Promise<void> {
  for (const reply of parseInboundReplies(body)) {
    const clientId = await resolveClientIdByPhoneNumberId(reply.phoneNumberId);
    if (clientId == null) {
      console.error(
        `[WEBHOOK] Não foi possível resolver o cliente pro phoneNumberId "${reply.phoneNumberId}" — resposta de ${reply.from} (wamid ${reply.wamid}) ignorada.`,
      );
      continue;
    }
    try {
      await runWithClient(clientId, () => handleInboundReply(reply));
    } catch (err) {
      console.error("[WEBHOOK] Falha ao processar resposta:", (err as Error).message);
    }
  }

  for (const update of parseStatusUpdates(body)) {
    const clientId = await resolveClientIdByPhoneNumberId(update.phoneNumberId);
    if (clientId == null) {
      console.error(
        `[WEBHOOK] Não foi possível resolver o cliente pro phoneNumberId "${update.phoneNumberId}" — status de ${update.wamid} ignorado.`,
      );
      continue;
    }
    try {
      await runWithClient(clientId, () => handleStatusUpdate(update));
    } catch (err) {
      console.error("[WEBHOOK] Falha ao processar status:", (err as Error).message);
    }
  }
}
