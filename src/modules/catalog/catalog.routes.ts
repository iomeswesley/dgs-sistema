import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth } from "@/middleware/auth.js";
import { parseBody, routeId } from "@/lib/http.js";
import { recordAudit, recordFieldChanges } from "@/modules/audit/audit.service.js";

/*
  Cadastros base: municípios, unidades, médicos, procedimentos e a
  configuração de procedimento por médico (tempo, esperado/dia e valores).

  A baixa normal é lógica (`active`): apagar um médico que já tem
  agendamento quebraria o histórico dos indicadores. Mas cadastro criado por
  engano (nunca usado) precisa poder sair de vez — os DELETE abaixo só
  excluem quando NADA referencia o registro; senão respondem 409 explicando
  o que o prende e sugerindo Desativar.
*/

export const catalogRouter = Router();
catalogRouter.use("/api/catalog", requireAuth);

/** "3 agendamentos, 1 lista" — só o que for > 0. */
function describeUsage(parts: [number, string, string][]): string {
  return parts
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`)
    .join(", ");
}

function blockedMessage(what: string, usage: string): string {
  return `Não dá para excluir ${what}: está em uso (${usage}). Para tirar das opções sem perder o histórico, use Desativar.`;
}

/* ---------------- Municípios ---------------- */

const municipalitySchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  state: z.string().length(2, "Use a sigla do estado, com 2 letras (ex.: SC)").default("SC"),
  notes: z.string().nullish(),
  active: z.boolean().optional(),
});

catalogRouter.get(
  "/api/catalog/municipalities",
  asyncHandler(async (_req, res) => {
    const municipalities = await prisma.municipality.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { units: true, appointments: true } } },
    });
    res.json({ municipalities });
  })
);

catalogRouter.post(
  "/api/catalog/municipalities",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, municipalitySchema);
    const municipality = await prisma.municipality.create({ data: { ...data, clientId: requireActiveClientId() } });
    await recordAudit({
      userId: currentUserId(req),
      action: "create",
      entity: "Municipality",
      entityId: municipality.id,
      newValue: municipality.name,
    });
    res.status(201).json({ municipality });
  })
);

catalogRouter.patch(
  "/api/catalog/municipalities/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const data = parseBody(req, municipalitySchema.partial());
    const before = await prisma.municipality.findUnique({ where: { id } });
    if (!before) throw new AppError("Município não encontrado", 404);

    const municipality = await prisma.municipality.update({ where: { id }, data });
    await recordFieldChanges(
      { userId: currentUserId(req), action: "update", entity: "Municipality", entityId: id },
      before,
      data
    );
    res.json({ municipality });
  })
);

catalogRouter.delete(
  "/api/catalog/municipalities/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const municipality = await prisma.municipality.findUnique({ where: { id } });
    if (!municipality) throw new AppError("Município não encontrado", 404);

    const [agendas, lists, appointments, closings] = await Promise.all([
      prisma.agenda.count({ where: { municipalityId: id } }),
      prisma.list.count({ where: { municipalityId: id } }),
      prisma.appointment.count({ where: { municipalityId: id } }),
      prisma.dailyClosing.count({ where: { municipalityId: id } }),
    ]);
    const usage = describeUsage([
      [agendas, "agenda", "agendas"],
      [lists, "lista", "listas"],
      [appointments, "agendamento", "agendamentos"],
      [closings, "fechamento", "fechamentos"],
    ]);
    if (usage) throw new AppError(blockedMessage("este município", usage), 409);

    // Unidades do município saem junto — mas só se nenhuma delas for
    // referenciada em algum lugar (ex.: unidade solicitante de um paciente).
    const units = await prisma.healthUnit.findMany({ where: { municipalityId: id }, select: { id: true, name: true } });
    for (const unit of units) {
      const inUse = await prisma.appointment.count({ where: { requestingUnitId: unit.id } });
      if (inUse > 0) {
        throw new AppError(
          `Não dá para excluir o município: a unidade "${unit.name}" dele está em uso (${inUse} agendamento(s)). Use Desativar.`,
          409
        );
      }
    }
    await prisma.$transaction([
      prisma.healthUnit.deleteMany({ where: { municipalityId: id } }),
      prisma.municipality.delete({ where: { id } }),
    ]);
    await recordAudit({
      userId: currentUserId(req),
      action: "delete",
      entity: "Municipality",
      entityId: id,
      metadata: { name: municipality.name, unitsDeleted: units.length },
    });
    res.status(204).end();
  })
);

/* ---------------- Unidades de saúde ---------------- */

const unitSchema = z.object({
  municipalityId: z.number().int().positive(),
  name: z.string().min(1, "Nome é obrigatório"),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  active: z.boolean().optional(),
});

catalogRouter.get(
  "/api/catalog/units",
  asyncHandler(async (req, res) => {
    const municipalityId = req.query.municipalityId ? Number(req.query.municipalityId) : undefined;
    const units = await prisma.healthUnit.findMany({
      where: municipalityId ? { municipalityId } : undefined,
      orderBy: [{ municipalityId: "asc" }, { name: "asc" }],
      include: { municipality: { select: { name: true } } },
    });
    res.json({ units });
  })
);

catalogRouter.post(
  "/api/catalog/units",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, unitSchema);
    const unit = await prisma.healthUnit.create({ data: { ...data, clientId: requireActiveClientId() } });
    await recordAudit({
      userId: currentUserId(req),
      action: "create",
      entity: "HealthUnit",
      entityId: unit.id,
      newValue: unit.name,
    });
    res.status(201).json({ unit });
  })
);

catalogRouter.patch(
  "/api/catalog/units/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const data = parseBody(req, unitSchema.partial());
    const before = await prisma.healthUnit.findUnique({ where: { id } });
    if (!before) throw new AppError("Unidade não encontrada", 404);

    const unit = await prisma.healthUnit.update({ where: { id }, data });
    await recordFieldChanges(
      { userId: currentUserId(req), action: "update", entity: "HealthUnit", entityId: id },
      before,
      data
    );
    res.json({ unit });
  })
);

catalogRouter.delete(
  "/api/catalog/units/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const unit = await prisma.healthUnit.findUnique({ where: { id } });
    if (!unit) throw new AppError("Unidade não encontrada", 404);
    const [agendas, appointments] = await Promise.all([
      prisma.agenda.count({ where: { unitId: id } }),
      prisma.appointment.count({ where: { requestingUnitId: id } }),
    ]);
    const usage = describeUsage([
      [agendas, "agenda", "agendas"],
      [appointments, "agendamento", "agendamentos"],
    ]);
    if (usage) throw new AppError(blockedMessage("esta unidade", usage), 409);
    await prisma.healthUnit.delete({ where: { id } });
    await recordAudit({
      userId: currentUserId(req),
      action: "delete",
      entity: "HealthUnit",
      entityId: id,
      metadata: { name: unit.name },
    });
    res.status(204).end();
  })
);

/* ---------------- Médicos ---------------- */

const doctorSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  specialty: z.string().nullish(),
  registration: z.string().nullish(),
  active: z.boolean().optional(),
});

catalogRouter.get(
  "/api/catalog/doctors",
  asyncHandler(async (_req, res) => {
    const doctors = await prisma.doctor.findMany({
      orderBy: { name: "asc" },
      include: {
        procedures: {
          include: { procedure: { select: { id: true, name: true } } },
          orderBy: { procedureId: "asc" },
        },
      },
    });
    res.json({ doctors });
  })
);

catalogRouter.post(
  "/api/catalog/doctors",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, doctorSchema);
    const doctor = await prisma.doctor.create({ data: { ...data, clientId: requireActiveClientId() } });
    await recordAudit({
      userId: currentUserId(req),
      action: "create",
      entity: "Doctor",
      entityId: doctor.id,
      newValue: doctor.name,
    });
    res.status(201).json({ doctor });
  })
);

catalogRouter.patch(
  "/api/catalog/doctors/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const data = parseBody(req, doctorSchema.partial());
    const before = await prisma.doctor.findUnique({ where: { id } });
    if (!before) throw new AppError("Médico não encontrado", 404);

    const doctor = await prisma.doctor.update({ where: { id }, data });
    await recordFieldChanges(
      { userId: currentUserId(req), action: "update", entity: "Doctor", entityId: id },
      before,
      data
    );
    res.json({ doctor });
  })
);

catalogRouter.delete(
  "/api/catalog/doctors/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const doctor = await prisma.doctor.findUnique({ where: { id } });
    if (!doctor) throw new AppError("Médico não encontrado", 404);
    const [agendas, appointments, closings] = await Promise.all([
      prisma.agenda.count({ where: { doctorId: id } }),
      prisma.appointment.count({ where: { doctorId: id } }),
      prisma.dailyClosing.count({ where: { doctorId: id } }),
    ]);
    const usage = describeUsage([
      [agendas, "agenda", "agendas"],
      [appointments, "agendamento", "agendamentos"],
      [closings, "fechamento", "fechamentos"],
    ]);
    if (usage) throw new AppError(blockedMessage("este médico", usage), 409);
    // Configurações de procedimento por médico saem junto (cascade no banco).
    await prisma.doctor.delete({ where: { id } });
    await recordAudit({
      userId: currentUserId(req),
      action: "delete",
      entity: "Doctor",
      entityId: id,
      metadata: { name: doctor.name },
    });
    res.status(204).end();
  })
);

/* ---------------- Procedimentos ---------------- */

const procedureSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  preparationInstructions: z.string().nullish(),
  active: z.boolean().optional(),
});

catalogRouter.get(
  "/api/catalog/procedures",
  asyncHandler(async (_req, res) => {
    const procedures = await prisma.procedure.findMany({ orderBy: { name: "asc" } });
    res.json({ procedures });
  })
);

catalogRouter.post(
  "/api/catalog/procedures",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, procedureSchema);
    const procedure = await prisma.procedure.create({ data: { ...data, clientId: requireActiveClientId() } });
    await recordAudit({
      userId: currentUserId(req),
      action: "create",
      entity: "Procedure",
      entityId: procedure.id,
      newValue: procedure.name,
    });
    res.status(201).json({ procedure });
  })
);

catalogRouter.patch(
  "/api/catalog/procedures/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const data = parseBody(req, procedureSchema.partial());
    const before = await prisma.procedure.findUnique({ where: { id } });
    if (!before) throw new AppError("Procedimento não encontrado", 404);

    const procedure = await prisma.procedure.update({ where: { id }, data });
    await recordFieldChanges(
      { userId: currentUserId(req), action: "update", entity: "Procedure", entityId: id },
      before,
      data
    );
    res.json({ procedure });
  })
);

catalogRouter.delete(
  "/api/catalog/procedures/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const procedure = await prisma.procedure.findUnique({ where: { id } });
    if (!procedure) throw new AppError("Procedimento não encontrado", 404);
    const [agendas, appointments, closings] = await Promise.all([
      prisma.agenda.count({ where: { procedureId: id } }),
      prisma.appointment.count({ where: { procedureId: id } }),
      prisma.dailyClosing.count({ where: { procedureId: id } }),
    ]);
    const usage = describeUsage([
      [agendas, "agenda", "agendas"],
      [appointments, "agendamento", "agendamentos"],
      [closings, "fechamento", "fechamentos"],
    ]);
    if (usage) throw new AppError(blockedMessage("este procedimento", usage), 409);
    await prisma.procedure.delete({ where: { id } });
    await recordAudit({
      userId: currentUserId(req),
      action: "delete",
      entity: "Procedure",
      entityId: id,
      metadata: { name: procedure.name },
    });
    res.status(204).end();
  })
);

/* ---------------- Procedimento por médico (valores) ---------------- */

const doctorProcedureSchema = z.object({
  doctorId: z.number().int().positive(),
  procedureId: z.number().int().positive(),
  minutesPerVisit: z.number().int().positive().nullish(),
  expectedPerDay: z.number().int().positive().nullish(),
  doctorFee: z.number().nonnegative().nullish(),
  cityRate: z.number().nonnegative().nullish(),
  active: z.boolean().optional(),
});

catalogRouter.put(
  "/api/catalog/doctor-procedures",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, doctorProcedureSchema);
    const { doctorId, procedureId, ...rest } = data;

    const before = await prisma.doctorProcedure.findUnique({
      where: { doctorId_procedureId: { doctorId, procedureId } },
    });

    const record = await prisma.doctorProcedure.upsert({
      where: { doctorId_procedureId: { doctorId, procedureId } },
      create: { doctorId, procedureId, ...rest, clientId: requireActiveClientId() },
      update: rest,
    });

    // Valor é lançamento sensível — vira pagamento. Auditar campo a campo.
    await recordFieldChanges(
      {
        userId: currentUserId(req),
        action: before ? "update" : "create",
        entity: "DoctorProcedure",
        entityId: record.id,
      },
      before ? { ...before, doctorFee: before.doctorFee?.toString(), cityRate: before.cityRate?.toString() } : {},
      rest
    );

    res.json({ doctorProcedure: record });
  })
);

/** Remove só a configuração médico × procedimento (tempo/valores); não mexe em histórico. */
catalogRouter.delete(
  "/api/catalog/doctor-procedures/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const record = await prisma.doctorProcedure.findUnique({ where: { id } });
    if (!record) throw new AppError("Configuração não encontrada", 404);
    await prisma.doctorProcedure.delete({ where: { id } });
    await recordAudit({
      userId: currentUserId(req),
      action: "delete",
      entity: "DoctorProcedure",
      entityId: id,
      metadata: { doctorId: record.doctorId, procedureId: record.procedureId },
    });
    res.status(204).end();
  })
);
