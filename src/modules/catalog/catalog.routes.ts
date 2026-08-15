import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth } from "@/middleware/auth.js";
import { parseBody, routeId } from "@/lib/http.js";
import { recordAudit, recordFieldChanges } from "@/modules/audit/audit.service.js";

/*
  Cadastros base: municípios, unidades, médicos, procedimentos e a
  configuração de procedimento por médico (tempo, esperado/dia e valores).

  Nada aqui é excluído de verdade — tudo tem `active`. Apagar um médico que
  já tem agendamento quebraria o histórico dos indicadores, então a baixa é
  lógica.
*/

export const catalogRouter = Router();
catalogRouter.use("/api/catalog", requireAuth);

/* ---------------- Municípios ---------------- */

const municipalitySchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  state: z.string().length(2).default("SC"),
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
    const municipality = await prisma.municipality.create({ data });
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
    const unit = await prisma.healthUnit.create({ data });
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
    const doctor = await prisma.doctor.create({ data });
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
    const procedure = await prisma.procedure.create({ data });
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
      create: { doctorId, procedureId, ...rest },
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
