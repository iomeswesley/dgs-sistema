import { Router } from "express";
import { z } from "zod";
import { env } from "@/config/env.js";
import { asyncHandler } from "@/middleware/errorHandler.js";
import { AppError } from "@/middleware/errorHandler.js";
import { requireAuth, currentUserId } from "@/middleware/auth.js";
import { parseBody } from "@/lib/http.js";
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
