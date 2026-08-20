import { Router } from "express";
import { z } from "zod";
import type { TemplateKind } from "@prisma/client";
import { env } from "@/config/env.js";
import { prisma } from "@/lib/prisma.js";
import { asyncHandler } from "@/middleware/errorHandler.js";
import { AppError } from "@/middleware/errorHandler.js";
import { requireAuth, currentUserId } from "@/middleware/auth.js";
import { parseBody } from "@/lib/http.js";
import { normalizePhoneList } from "@/lib/phone.js";
import { sendTemplate } from "@/lib/whatsapp.js";
import { TEMPLATE_NAMES } from "@/lib/templates.js";
import {
  adoptEnvAccount,
  exchangeSignupCode,
  getConnectionStatus,
  listAccounts,
  removeAccount,
  renameAccount,
  saveConnection,
  setActiveAccount,
  subscribeAppToWaba,
} from "./whatsapp-account.service.js";
import { getTemplateStatuses, registerPhoneNumber, submitDefaultTemplates } from "@/lib/whatsapp-templates.js";

export const whatsappSignupRouter = Router();
whatsappSignupRouter.use("/api/whatsapp/signup", requireAuth);

/** Dados públicos (não-segredos) que o frontend precisa pra montar o FB.login. */
whatsappSignupRouter.get(
  "/api/whatsapp/signup/config",
  asyncHandler(async (_req, res) => {
    res.json({
      appId: env.WHATSAPP_APP_ID ?? null,
      configId: env.WHATSAPP_SIGNUP_CONFIG_ID ?? null,
      // Cai pra mesma config quando não existe uma dedicada pra
      // coexistência (é o caso hoje — ver comentário em config/env.ts).
      configIdCoexistence: env.WHATSAPP_SIGNUP_CONFIG_ID_COEXISTENCE ?? env.WHATSAPP_SIGNUP_CONFIG_ID ?? null,
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

    // Best-effort: sem isso o número conecta mas não consegue enviar nada
    // (número precisa estar registrado na Cloud API; templates novos
    // precisam ser submetidos pra WABA nova não ter nenhum aprovado ainda).
    // Falha aqui não desfaz a conexão — a equipe vê o status pendente na
    // tela e, se o registro do número falhar, o próximo envio real mostra
    // o erro (#133010) de novo, mas a conta já está visível/gerenciável.
    try {
      await registerPhoneNumber(body.phoneNumberId, accessToken);
    } catch (err) {
      console.error("[WHATSAPP SIGNUP] Falha ao registrar o número na Cloud API:", (err as Error).message);
    }
    try {
      await submitDefaultTemplates(body.wabaId, accessToken);
    } catch (err) {
      console.error("[WHATSAPP SIGNUP] Falha ao submeter templates padrão:", (err as Error).message);
    }

    res.json({ status: await getConnectionStatus() });
  })
);

/**
 * Status de aprovação dos templates padrão na WABA ativa — a tela usa isso
 * pra mostrar o aviso de "pendente aprovação da Meta" até os 3 templates
 * saírem de PENDING.
 */
whatsappSignupRouter.get(
  "/api/whatsapp/signup/templates",
  asyncHandler(async (_req, res) => {
    const status = await getConnectionStatus();
    if (!status.connected || !status.wabaId) {
      return res.json({ templates: [], billingIssue: false, billingUrl: null });
    }
    const account = await prisma.whatsappAccount.findFirst({
      where: { wabaId: status.wabaId },
      orderBy: { connectedAt: "desc" },
    });
    if (!account) return res.json({ templates: [], billingIssue: false, billingUrl: null });

    // Não existe campo confiável na Graph API pra saber se a WABA já tem
    // forma de pagamento cadastrada — a Meta só revela isso no momento do
    // envio, com o erro 131042 ("Business eligibility payment issue"). Por
    // isso o aviso é reativo: olha se o envio mais recente falhou por esse
    // motivo específico, não um "check" ativo.
    const lastSent = await prisma.whatsappMessage.findFirst({
      where: { direction: "ENVIADA" },
      orderBy: { createdAt: "desc" },
    });
    const billingIssue = lastSent?.status === "FALHOU" && lastSent.errorCode === "131042";
    const billingUrl = `https://business.facebook.com/billing_hub/accounts/details/?asset_id=${account.wabaId}&wizard_name=CHANGE_COUNTRY_CURRENCY&account_type=whatsapp-business-account`;

    try {
      const templates = await getTemplateStatuses(account.wabaId, account.accessToken);
      res.json({ templates, billingIssue, billingUrl });
    } catch (err) {
      throw new AppError((err as Error).message, 502);
    }
  })
);

/** Lista todas as contas conectadas — base do seletor de failover na tela. */
whatsappSignupRouter.get(
  "/api/whatsapp/signup/accounts",
  asyncHandler(async (_req, res) => {
    res.json({ accounts: await listAccounts() });
  })
);

/**
 * Adota o fallback do .env como conta gerenciável (edita apelido, remove) —
 * botão "Gerenciar pela tela" no card do número via .env.
 */
whatsappSignupRouter.post(
  "/api/whatsapp/signup/accounts/adopt-env",
  asyncHandler(async (req, res) => {
    await adoptEnvAccount(currentUserId(req));
    res.json({ status: await getConnectionStatus(), accounts: await listAccounts() });
  })
);

/** Troca qual conta está ativa (o botão de failover manual). */
whatsappSignupRouter.post(
  "/api/whatsapp/signup/accounts/:id/activate",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError("ID inválido.", 400);
    await setActiveAccount(id, currentUserId(req));
    res.json({ status: await getConnectionStatus(), accounts: await listAccounts() });
  })
);

const renameSchema = z.object({ label: z.string().max(60).nullish() });

/** Renomeia o apelido interno de uma conta (só rótulo, nada muda na Meta). */
whatsappSignupRouter.patch(
  "/api/whatsapp/signup/accounts/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError("ID inválido.", 400);
    const { label } = parseBody(req, renameSchema);
    await renameAccount(id, label ?? null, currentUserId(req));
    res.json({ accounts: await listAccounts() });
  })
);

/** Remove uma conta específica (não apaga as outras, ver removeAccount). */
whatsappSignupRouter.delete(
  "/api/whatsapp/signup/accounts/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError("ID inválido.", 400);
    await removeAccount(id, currentUserId(req));
    res.json({ status: await getConnectionStatus(), accounts: await listAccounts() });
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
