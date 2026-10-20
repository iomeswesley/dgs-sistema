import { prisma } from "@/lib/prisma.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";
import { AppError } from "@/middleware/errorHandler.js";

/*
  Configurações do sistema que a equipe ajusta sem precisar de deploy —
  hoje só a retenção da mídia recebida do paciente (WhatsappMessage.mediaData,
  ver whatsapp.service.ts). Uma linha por cliente (`AppSettings.clientId`,
  @unique) desde a Fase 0 do plano multi-cliente — `admin.routes.ts`
  garante que todo cliente novo já nasce com a dele.
*/

export interface AppSettings {
  mediaRetentionDays: number;
  /** Módulos do cliente — só leitura aqui; quem edita é o super admin (client-features.service.ts). */
  features: ClientFeatures;
}

export interface ClientFeatures {
  messageFlow: "CONFIRMACAO" | "OFERTA";
  senderName: string | null;
  moduleLembrete: boolean;
  moduleCancelamento: boolean;
}

export function toFeatures(row: ClientFeatures): ClientFeatures {
  return {
    messageFlow: row.messageFlow,
    senderName: row.senderName,
    moduleLembrete: row.moduleLembrete,
    moduleCancelamento: row.moduleCancelamento,
  };
}

export async function getSettings(): Promise<AppSettings> {
  const settings = await prisma.appSettings.findUnique({ where: { clientId: requireActiveClientId() } });
  // admin.routes.ts garante a linha na criação do cliente — se não achar,
  // algo deu muito errado (cliente criado antes dessa garantia existir,
  // banco restaurado sem a migration). Não inventa um default silencioso
  // pra não mascarar isso.
  if (!settings) throw new AppError("Configurações do sistema não encontradas pra este cliente.", 500);
  return { mediaRetentionDays: settings.mediaRetentionDays, features: toFeatures(settings) };
}

export interface UpdateSettingsInput {
  mediaRetentionDays?: number;
}

export async function updateSettings(input: UpdateSettingsInput): Promise<AppSettings> {
  if (input.mediaRetentionDays !== undefined && (input.mediaRetentionDays < 1 || input.mediaRetentionDays > 365)) {
    throw new AppError("Retenção de mídia precisa estar entre 1 e 365 dias.", 400);
  }

  const settings = await prisma.appSettings.update({
    where: { clientId: requireActiveClientId() },
    data: { mediaRetentionDays: input.mediaRetentionDays },
  });
  return { mediaRetentionDays: settings.mediaRetentionDays, features: toFeatures(settings) };
}
