import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { toFeatures, type ClientFeatures } from "@/modules/settings/settings.service.js";

/*
  Módulos por cliente (2026-10-20): o super admin decide, em /admin, qual
  fluxo de mensagem o cliente usa (confirmação de consulta já marcada ou
  oferta de consulta), o nome do remetente e quais módulos ficam ligados.
  Rota separada de PATCH /api/settings de propósito — aquela é aberta a
  qualquer usuário do cliente, esta só ao super admin.
*/

export async function getClientFeatures(clientId: number): Promise<ClientFeatures> {
  const row = await prisma.appSettings.findUnique({ where: { clientId } });
  if (!row) throw new AppError("Configurações do sistema não encontradas pra este cliente.", 500);
  return toFeatures(row);
}

export async function setClientFeatures(
  clientId: number,
  input: Partial<ClientFeatures>,
  userId: number | null
): Promise<ClientFeatures> {
  const before = await getClientFeatures(clientId);
  const senderName = input.senderName === undefined ? undefined : input.senderName?.trim() || null;
  const row = await prisma.appSettings.update({
    where: { clientId },
    data: {
      messageFlow: input.messageFlow,
      senderName,
      moduleLembrete: input.moduleLembrete,
      moduleCancelamento: input.moduleCancelamento,
    },
  });
  const after = toFeatures(row);
  await recordAudit({
    clientId,
    userId,
    action: "admin.edit_client_features",
    entity: "Client",
    entityId: clientId,
    oldValue: JSON.stringify(before),
    newValue: JSON.stringify(after),
  });
  return after;
}
