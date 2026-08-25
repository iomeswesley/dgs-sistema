import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";

/*
  Configurações do sistema que a equipe ajusta sem precisar de deploy —
  hoje só a retenção da mídia recebida do paciente (WhatsappMessage.mediaData,
  ver whatsapp.service.ts). Linha única (id sempre 1), criada pela migration
  `20260827000000_whatsapp_media_and_settings`.
*/

const SETTINGS_ID = 1;

export interface AppSettings {
  mediaRetentionDays: number;
}

export async function getSettings(): Promise<AppSettings> {
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  // A migration já insere a linha — se não achar, algo deu muito errado
  // (banco restaurado sem a migration, por exemplo). Não inventa um default
  // silencioso pra não mascarar isso.
  if (!settings) throw new AppError("Configurações do sistema não encontradas.", 500);
  return { mediaRetentionDays: settings.mediaRetentionDays };
}

export interface UpdateSettingsInput {
  mediaRetentionDays?: number;
}

export async function updateSettings(input: UpdateSettingsInput): Promise<AppSettings> {
  if (input.mediaRetentionDays !== undefined && (input.mediaRetentionDays < 1 || input.mediaRetentionDays > 365)) {
    throw new AppError("Retenção de mídia precisa estar entre 1 e 365 dias.", 400);
  }

  const settings = await prisma.appSettings.update({
    where: { id: SETTINGS_ID },
    data: { mediaRetentionDays: input.mediaRetentionDays },
  });
  return { mediaRetentionDays: settings.mediaRetentionDays };
}
