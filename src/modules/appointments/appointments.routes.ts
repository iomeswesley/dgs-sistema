import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth } from "@/middleware/auth.js";
import { dateOnlySchema, parseBody, parseDateOnly, parseQuery, routeId } from "@/lib/http.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { queueCapacity } from "@/modules/queue/queue.service.js";

/*
  Acompanhamento do dia: quem confirmou, quem recusou, quem não respondeu e
  quem não pôde ser contatado — com as ações que a equipe precisa (registrar
  contato manual, marcar o motivo da recusa).
*/

export const appointmentsRouter = Router();
appointmentsRouter.use("/api/appointments", requireAuth);

appointmentsRouter.get(
  "/api/appointments",
  asyncHandler(async (req, res) => {
    const query = parseQuery(
      req,
      z.object({
        from: dateOnlySchema.optional(),
        to: dateOnlySchema.optional(),
        doctorId: z.coerce.number().int().positive().optional(),
        municipalityId: z.coerce.number().int().positive().optional(),
        status: z.string().optional(),
        listId: z.coerce.number().int().positive().optional(),
      })
    );

    const from = query.from ? parseDateOnly(query.from) : undefined;
    const to = query.to ? new Date(parseDateOnly(query.to).getTime() + 86_400_000 - 1) : undefined;

    const appointments = await prisma.appointment.findMany({
      where: {
        scheduledAt: from || to ? { gte: from, lte: to } : undefined,
        doctorId: query.doctorId,
        municipalityId: query.municipalityId,
        listId: query.listId,
        status: query.status ? (query.status as never) : undefined,
      },
      orderBy: [{ scheduledAt: "asc" }],
      take: 500,
      include: {
        patient: { select: { id: true, name: true, phones: true, optedOut: true } },
        doctor: { select: { id: true, name: true } },
        procedure: { select: { id: true, name: true } },
        municipality: { select: { id: true, name: true } },
        contactedBy: { select: { name: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: {
            direction: true,
            status: true,
            body: true,
            buttonPayload: true,
            errorMessage: true,
            createdAt: true,
            raw: true,
          },
        },
      },
    });

    res.json({ appointments, capacity: await queueCapacity() });
  })
);

/** Resumo por status para a faixa de composição. */
appointmentsRouter.get(
  "/api/appointments/summary",
  asyncHandler(async (req, res) => {
    const query = parseQuery(
      req,
      z.object({ from: dateOnlySchema.optional(), to: dateOnlySchema.optional() })
    );
    const from = query.from ? parseDateOnly(query.from) : undefined;
    const to = query.to ? new Date(parseDateOnly(query.to).getTime() + 86_400_000 - 1) : undefined;

    const rows = await prisma.appointment.groupBy({
      by: ["status"],
      where: { scheduledAt: from || to ? { gte: from, lte: to } : undefined },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.status] = row._count._all;
    res.json({ counts });
  })
);

const contactSchema = z.object({
  /** Resultado do contato por telefone feito pela equipe. */
  outcome: z.enum(["CONFIRMADO", "RECUSADO", "SEM_RESPOSTA"]),
  refusalReason: z
    .enum(["JA_FEZ", "HORARIO_RUIM", "SEM_TRANSPORTE", "MUDOU_SE", "TELEFONE_ERRADO", "OBITO", "OUTRO"])
    .nullish(),
  refusalNote: z.string().nullish(),
  contactNote: z.string().nullish(),
});

/**
 * Registra contato manual (a equipe ligou).
 *
 * Sem isso esses casos voltariam para o papel com marca-texto — que é
 * exatamente o processo que o sistema substitui.
 */
appointmentsRouter.post(
  "/api/appointments/:id/contact",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const data = parseBody(req, contactSchema);
    const before = await prisma.appointment.findUnique({ where: { id } });
    if (!before) throw new AppError("Agendamento não encontrado", 404);

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        status: data.outcome,
        refusalReason: data.outcome === "RECUSADO" ? (data.refusalReason ?? "OUTRO") : null,
        refusalNote: data.outcome === "RECUSADO" ? data.refusalNote : null,
        contactedById: currentUserId(req),
        contactedAt: new Date(),
        contactNote: data.contactNote,
        respondedAt: new Date(),
      },
    });

    await recordAudit({
      userId: currentUserId(req),
      action: "manual_contact",
      entity: "Appointment",
      entityId: id,
      field: "status",
      oldValue: before.status,
      newValue: data.outcome,
      metadata: { refusalReason: data.refusalReason ?? null },
    });

    res.json({ appointment });
  })
);

const refusalSchema = z.object({
  refusalReason: z.enum([
    "JA_FEZ",
    "HORARIO_RUIM",
    "SEM_TRANSPORTE",
    "MUDOU_SE",
    "TELEFONE_ERRADO",
    "OBITO",
    "OUTRO",
  ]),
  refusalNote: z.string().nullish(),
});

/** Classifica o motivo de quem recusou pelo botão (o botão não diz o porquê). */
appointmentsRouter.post(
  "/api/appointments/:id/refusal-reason",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const data = parseBody(req, refusalSchema);
    const before = await prisma.appointment.findUnique({ where: { id } });
    if (!before) throw new AppError("Agendamento não encontrado", 404);
    if (before.status !== "RECUSADO") {
      throw new AppError("Só quem recusou tem motivo de recusa.", 409);
    }

    await prisma.appointment.update({
      where: { id },
      data: { refusalReason: data.refusalReason, refusalNote: data.refusalNote },
    });
    await recordAudit({
      userId: currentUserId(req),
      action: "refusal_reason",
      entity: "Appointment",
      entityId: id,
      oldValue: before.refusalReason,
      newValue: data.refusalReason,
    });

    res.json({ ok: true });
  })
);

/** Marca opt-out a pedido do paciente registrado pela equipe. */
appointmentsRouter.post(
  "/api/appointments/:id/opt-out",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const appointment = await prisma.appointment.findUnique({ where: { id } });
    if (!appointment) throw new AppError("Agendamento não encontrado", 404);

    await prisma.patient.update({
      where: { id: appointment.patientId },
      data: { optedOut: true, optedOutAt: new Date() },
    });
    await prisma.messageJob.updateMany({
      where: { appointmentId: id, status: "PENDENTE" },
      data: { status: "CANCELADO", lastError: "Paciente pediu para não receber mensagens" },
    });
    await recordAudit({
      userId: currentUserId(req),
      action: "opt_out",
      entity: "Patient",
      entityId: appointment.patientId,
    });

    res.json({ ok: true });
  })
);
