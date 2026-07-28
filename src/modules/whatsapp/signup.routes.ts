import { Router } from "express";
import { z } from "zod";
import type { TemplateKind } from "@prisma/client";
import { env } from "@/config/env.js";
import { asyncHandler } from "@/middleware/errorHandler.js";
import { AppError } from "@/middleware/errorHandler.js";
import { requireAuth, currentUserId } from "@/middleware/auth.js";
import { parseBody } from "@/lib/http.js";
import { normalizePhoneList } from "@/lib/phone.js";
import { sendTemplate } from "@/lib/whatsapp.js";
import { TEMPLATE_NAMES } from "@/lib/templates.js";
import {
  disconnectAccount,
  exchangeSignupCode,
  getConnectionStatus,
  saveConnection,
  subscribeAppToWaba,
} from "./whatsapp-account.service.js";

export const whatsappSignupRouter = Router();
whatsappSignupRouter.use("/api/whatsapp/signup", requireAuth);

/** Dados públicos (não-segredos) que o frontend precisa pra montar o FB.login. */
whatsappSignupRouter.get(
  "/api/whatsapp/signup/config",
  asyncHandler(async (_req, res) => {
    res.json({
      appId: env.WHATSAPP_APP_ID ?? null,
      configId: env.WHATSAPP_SIGNUP_CONFIG_ID ?? null,
      status: await getConnectionStatus(),
    });
  })
);

const callbackSchema = z.object({
  code: z.string().min(1),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  businessName: z.string().nullish(),
});

/**
 * Recebe o retorno do Embedded Signup: `code` vem do FB.login, `wabaId` e
 * `phoneNumberId` vêm do evento postMessage disparado durante o fluxo (a
 * troca do code por token não devolve esses IDs).
 */
whatsappSignupRouter.post(
  "/api/whatsapp/signup/callback",
  asyncHandler(async (req, res) => {
    const body = parseBody(req, callbackSchema);

    let accessToken: string;
    try {
      accessToken = await exchangeSignupCode(body.code);
    } catch (err) {
      throw new AppError((err as Error).message, 502);
    }

    try {
      await subscribeAppToWaba(body.wabaId, accessToken);
    } catch (err) {
      throw new AppError((err as Error).message, 502);
    }

    await saveConnection({
      wabaId: body.wabaId,
      phoneNumberId: body.phoneNumberId,
      businessName: body.businessName ?? null,
      accessToken,
      connectedById: currentUserId(req),
    });

    res.json({ status: await getConnectionStatus() });
  })
);

whatsappSignupRouter.delete(
  "/api/whatsapp/signup",
  asyncHandler(async (req, res) => {
    await disconnectAccount(currentUserId(req));
    res.json({ status: await getConnectionStatus() });
  })
);

const testSendSchema = z.object({
  phone: z.string().min(8),
  template: z.enum(["CONFIRMACAO", "LEMBRETE", "VAGA_ABERTA"]),
});

/**
 * Manda um template com dados fictícios pra um número escolhido pela própria
 * equipe — nunca busca paciente/agendamento no banco. Existe pra conferir se
 * o envio e a formatação do template funcionam sem risco de mandar mensagem
 * de teste pra um telefone de paciente de verdade.
 */
whatsappSignupRouter.post(
  "/api/whatsapp/signup/test-send",
  asyncHandler(async (req, res) => {
    const { phone, template } = parseBody(req, testSendSchema);

    const [normalized] = normalizePhoneList([phone]);
    if (!normalized) throw new AppError("Telefone inválido.", 400);
    if (normalized.kind !== "mobile") throw new AppError("Só celular recebe WhatsApp.", 400);

    const params = buildTestParams(template);
    const result = await sendTemplate(normalized.e164, TEMPLATE_NAMES[template], params);
    res.json(result);
  })
);

function buildTestParams(template: TemplateKind) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const date = tomorrow.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = "10:00";
  const firstName = "Teste";
  const municipality = "Município de Teste";
  const procedure = "Procedimento de Teste";
  const local = "Unidade de Teste";

  if (template === "LEMBRETE") {
    return { body: [firstName, date, time, procedure, local, "Nenhum preparo especial necessário"] };
  }
  if (template === "VAGA_ABERTA") {
    return { body: [firstName, municipality, procedure, date, time, local] };
  }
  return { header: [municipality], body: [firstName, municipality, date, time, procedure, local] };
}
