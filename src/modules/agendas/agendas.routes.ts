import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth } from "@/middleware/auth.js";
import { dateOnlySchema, parseBody, parseDateOnly, parseQuery, routeId } from "@/lib/http.js";
import { recordAudit } from "@/modules/audit/audit.service.js";

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
        unit: { select: { id: true, name: true } },
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
