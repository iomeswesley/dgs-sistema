import { Router } from "express";
import { prisma } from "@/lib/prisma.js";
import { asyncHandler } from "@/middleware/errorHandler.js";
import { requireAuth } from "@/middleware/auth.js";
import { processQueue, queueCapacity } from "./queue.service.js";
import { enqueueReminders, enqueueRetries, purgeExpiredData } from "./cadence.service.js";
import { closeExpiredAppointments } from "@/modules/whatsapp/whatsapp.service.js";
import { isWhatsappConfigured } from "@/modules/whatsapp/whatsapp-account.service.js";

export const queueRouter = Router();
queueRouter.use("/api/queue", requireAuth);

queueRouter.get(
  "/api/queue",
  asyncHandler(async (_req, res) => {
    const [capacity, failed, whatsappConfigured] = await Promise.all([
      queueCapacity(),
      prisma.messageJob.findMany({
        where: { status: "FALHA" },
        orderBy: { processedAt: "desc" },
        take: 20,
        include: {
          appointment: { include: { patient: { select: { name: true } } } },
        },
      }),
      isWhatsappConfigured(),
    ]);
    res.json({ capacity, failed, whatsappConfigured });
  })
);

/** Processa agora, sem esperar o cron. */
queueRouter.post(
  "/api/queue/process",
  asyncHandler(async (_req, res) => {
    res.json(await processQueue());
  })
);

/** Recoloca na fila os envios que falharam (ex: instabilidade da Meta). */
queueRouter.post(
  "/api/queue/retry-failed",
  asyncHandler(async (_req, res) => {
    const result = await prisma.messageJob.updateMany({
      where: { status: "FALHA", attempts: { lt: 3 } },
      data: { status: "PENDENTE", scheduledFor: new Date() },
    });
    res.json({ requeued: result.count });
  })
);

/**
 * Roda a cadência do dia inteira na mão — os mesmos passos do cron
 * (/api/cron/queue), pra usar enquanto o cron horário não está ativo (plano
 * Hobby só roda 1x/dia): lembrete de véspera, reenvio por telefone
 * alternativo, envio da fila, fechamento de quem passou do horário sem
 * responder, e expurgo LGPD do que passou do prazo de retenção.
 */
queueRouter.post(
  "/api/queue/run-cadence",
  asyncHandler(async (_req, res) => {
    const reminders = await enqueueReminders();
    const retries = await enqueueRetries();
    const processed = await processQueue();
    const closed = await closeExpiredAppointments();
    const purged = await purgeExpiredData();
    res.json({
      ...processed,
      remindersQueued: reminders.queued,
      retriesQueued: retries.queued,
      closedAsNoAnswer: closed,
      purged,
    });
  })
);
