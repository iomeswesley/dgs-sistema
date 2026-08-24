import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth } from "@/middleware/auth.js";
import { dateOnlySchema, parseBody, parseDateOnly, parseQuery, routeId } from "@/lib/http.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { toCsv } from "@/lib/csv.js";
import { REFUSAL_REASON_LABEL } from "@/lib/labels.js";

/*
  Agenda = escala do médico num município e data. É o que permite saber o
  esperado ANTES da lista chegar, e é a âncora das listas complementares
  (uma agenda, várias listas).
*/

export const agendasRouter = Router();
agendasRouter.use("/api/agendas", requireAuth);

const agendaSchema = z.object({
  doctorId: z.number().int().positive(),
  municipalityId: z.number().int().positive(),
  unitId: z.number().int().positive().nullish(),
  procedureId: z.number().int().positive().nullish(),
  date: dateOnlySchema,
  shift: z.enum(["MANHA", "TARDE", "INTEGRAL"]).default("INTEGRAL"),
  capacity: z.number().int().positive().nullish(),
  notes: z.string().nullish(),
});

agendasRouter.get(
  "/api/agendas",
  asyncHandler(async (req, res) => {
    const query = parseQuery(
      req,
      z.object({
        from: dateOnlySchema.optional(),
        to: dateOnlySchema.optional(),
        doctorId: z.coerce.number().int().positive().optional(),
        municipalityId: z.coerce.number().int().positive().optional(),
      })
    );

    const agendas = await prisma.agenda.findMany({
      where: {
        date: {
          gte: query.from ? parseDateOnly(query.from) : undefined,
          lte: query.to ? parseDateOnly(query.to) : undefined,
        },
        doctorId: query.doctorId,
        municipalityId: query.municipalityId,
      },
      orderBy: [{ date: "desc" }, { doctorId: "asc" }],
      include: {
        doctor: { select: { id: true, name: true } },
        municipality: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, address: true } },
        procedure: { select: { id: true, name: true } },
        _count: { select: { lists: true, appointments: true } },
      },
      take: 200,
    });

    res.json({ agendas });
  })
);

agendasRouter.post(
  "/api/agendas",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, agendaSchema);
    const agenda = await prisma.agenda.create({
      data: { ...data, date: parseDateOnly(data.date) },
    });
    await recordAudit({
      userId: currentUserId(req),
      action: "create",
      entity: "Agenda",
      entityId: agenda.id,
      newValue: `${data.date} médico ${data.doctorId}`,
    });
    res.status(201).json({ agenda });
  })
);

agendasRouter.patch(
  "/api/agendas/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const data = parseBody(req, agendaSchema.partial());
    const before = await prisma.agenda.findUnique({ where: { id } });
    if (!before) throw new AppError("Agenda não encontrada", 404);

    const agenda = await prisma.agenda.update({
      where: { id },
      data: { ...data, date: data.date ? parseDateOnly(data.date) : undefined },
    });
    await recordAudit({ userId: currentUserId(req), action: "update", entity: "Agenda", entityId: id });
    res.json({ agenda });
  })
);

/*
  Reposição de vagas: quando alguém recusa ou não responde, o horário fica
  aberto. Este relatório é o que volta pra secretaria pedir substitutos —
  ela manda uma lista complementar, vinculada à mesma agenda (campo
  `agendaId` no upload), que o sistema dispara só pros horários vagos.
*/
async function openSlots(agendaId: number) {
  const agenda = await prisma.agenda.findUnique({
    where: { id: agendaId },
    include: {
      doctor: { select: { name: true } },
      municipality: { select: { name: true } },
      procedure: { select: { name: true } },
    },
  });
  if (!agenda) throw new AppError("Agenda não encontrada", 404);

  const appointments = await prisma.appointment.findMany({
    where: { agendaId, status: { in: ["RECUSADO", "SEM_RESPOSTA", "SEM_TELEFONE"] } },
    orderBy: { scheduledAt: "asc" },
    include: {
      patient: { select: { name: true } },
      procedure: { select: { name: true } },
      requestingUnit: { select: { name: true } },
    },
  });

  return { agenda, appointments };
}

agendasRouter.get(
  "/api/agendas/:id/open-slots",
  asyncHandler(async (req, res) => {
    const { agenda, appointments } = await openSlots(routeId(req));
    res.json({ agenda, slots: appointments });
  })
);

agendasRouter.get(
  "/api/agendas/:id/open-slots/export",
  asyncHandler(async (req, res) => {
    const { agenda, appointments } = await openSlots(routeId(req));

    const csv = toCsv(
      ["Horário vago", "Paciente que liberou", "Procedimento", "Situação anterior", "Motivo", "Unidade solicitante"],
      appointments.map((appointment) => [
        appointment.scheduledAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        appointment.patient.name,
        appointment.procedure.name,
        appointment.status === "RECUSADO"
          ? "Recusou"
          : appointment.status === "SEM_TELEFONE"
            ? "Sem telefone"
            : "Sem resposta",
        appointment.refusalReason ? (REFUSAL_REASON_LABEL[appointment.refusalReason] ?? "") : "",
        appointment.requestingUnit?.name ?? "",
      ])
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vagas-${agenda.doctor.name.replace(/\s+/g, "-")}-${agenda.date.toISOString().slice(0, 10)}.csv"`
    );
    res.send(csv);
  })
);

agendasRouter.delete(
  "/api/agendas/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const linked = await prisma.list.count({ where: { agendaId: id } });
    if (linked > 0) {
      throw new AppError("Essa agenda já tem lista vinculada e não pode ser excluída.", 409);
    }
    await prisma.agenda.delete({ where: { id } });
    await recordAudit({ userId: currentUserId(req), action: "delete", entity: "Agenda", entityId: id });
    res.status(204).end();
  })
);
