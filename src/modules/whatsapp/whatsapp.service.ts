import type { AppointmentStatus, DeliveryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma.js";
import { classifyReply } from "@/lib/templates.js";
import type { InboundReply, StatusUpdate } from "@/lib/whatsapp.js";

/*
  Tratamento do webhook.

  Duas coisas chegam aqui e as duas importam:

  - respostas dos pacientes (clique de botão ou texto livre);
  - `statuses` de entrega. Diferente da barbearia-saas, que ignora esse
    evento, aqui ele é parte do produto: telefone errado na lista da
    prefeitura é rotina, e "não entregue" vira o indicador de qualidade da
    lista devolvido à secretaria.

  Tudo é idempotente por `wamid` — a Meta reentrega o mesmo evento sem aviso.
*/

/** Encontra o agendamento mais recente que espera resposta desse telefone. */
async function findAppointmentForPhone(phone: string) {
  return prisma.appointment.findFirst({
    where: {
      selectedPhone: phone,
      status: { in: ["ENVIADO", "ENTREGUE"] },
    },
    orderBy: { scheduledAt: "asc" },
    include: { patient: true },
  });
}

export async function handleInboundReply(reply: InboundReply): Promise<void> {
  // Idempotência: mesmo wamid processado duas vezes não duplica nada.
  const known = await prisma.whatsappMessage.findUnique({ where: { wamid: reply.wamid } });
  if (known) return;

  const appointment = await findAppointmentForPhone(reply.from);
  const intent = classifyReply({ buttonPayload: reply.buttonPayload, text: reply.text });

  await prisma.whatsappMessage.create({
    data: {
      appointmentId: appointment?.id ?? null,
      wamid: reply.wamid,
      direction: "RECEBIDA",
      phone: reply.from,
      body: reply.text,
      buttonPayload: reply.buttonPayload,
      status: "ENTREGUE",
      raw: { intent } as never,
    },
  });

  // Opt-out vale mesmo sem agendamento casado: alguém pedindo pra sair não
  // pode continuar recebendo só porque não achamos a linha dele.
  if (intent === "opt_out") {
    await prisma.patient.updateMany({
      where: { phones: { has: reply.from } },
      data: { optedOut: true, optedOutAt: new Date() },
    });
    // Cancela o que ainda não saiu pra esse número.
    await prisma.messageJob.updateMany({
      where: { phone: reply.from, status: "PENDENTE" },
      data: { status: "CANCELADO", lastError: "Paciente pediu para não receber mensagens" },
    });
    return;
  }

  if (!appointment) return;

  if (intent === "confirm" || intent === "refuse") {
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        status: intent === "confirm" ? "CONFIRMADO" : "RECUSADO",
        respondedAt: reply.timestamp,
      },
    });
    return;
  }

  // Texto livre que não dá pra classificar fica como está e aparece no painel
  // pra equipe resolver — chutar aqui significaria contar um paciente como
  // confirmado sem ele ter confirmado.
}

const STATUS_MAP: Record<StatusUpdate["status"], DeliveryStatus> = {
  sent: "ENVIADO",
  delivered: "ENTREGUE",
  read: "LIDO",
  failed: "FALHOU",
};

export async function handleStatusUpdate(update: StatusUpdate): Promise<void> {
  const message = await prisma.whatsappMessage.findUnique({ where: { wamid: update.wamid } });
  if (!message) return;

  // Nunca retroceder: um "sent" que chega depois do "read" não pode
  // rebaixar o status (a Meta não garante ordem de entrega dos eventos).
  const rank: Record<DeliveryStatus, number> = { ENVIADO: 0, ENTREGUE: 1, LIDO: 2, FALHOU: 3 };
  const next = STATUS_MAP[update.status];
  if (rank[next] < rank[message.status] && next !== "FALHOU") return;

  await prisma.whatsappMessage.update({
    where: { id: message.id },
    data: {
      status: next,
      deliveredAt: update.status === "delivered" ? update.timestamp : undefined,
      readAt: update.status === "read" ? update.timestamp : undefined,
      failedAt: update.status === "failed" ? update.timestamp : undefined,
      errorCode: update.errorCode,
      errorMessage: update.errorMessage,
    },
  });

  if (!message.appointmentId) return;

  const appointment = await prisma.appointment.findUnique({ where: { id: message.appointmentId } });
  if (!appointment) return;

  // O status do agendamento só acompanha enquanto o paciente não respondeu.
  // Depois de CONFIRMADO/RECUSADO, entrega não muda mais nada.
  const openStatuses: AppointmentStatus[] = ["ENVIADO", "ENTREGUE", "FALHA"];
  if (!openStatuses.includes(appointment.status)) return;

  if (update.status === "failed") {
    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "FALHA" } });
    return;
  }
  if (update.status === "delivered" || update.status === "read") {
    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "ENTREGUE" } });
  }
}

/**
 * Fecha as listas cujo atendimento já passou: quem não respondeu vira
 * SEM_RESPOSTA, pra parar de contar como "aguardando" pra sempre.
 */
export async function closeExpiredAppointments(): Promise<number> {
  const result = await prisma.appointment.updateMany({
    where: {
      status: { in: ["ENVIADO", "ENTREGUE"] },
      scheduledAt: { lt: new Date() },
    },
    data: { status: "SEM_RESPOSTA" },
  });
  return result.count;
}
