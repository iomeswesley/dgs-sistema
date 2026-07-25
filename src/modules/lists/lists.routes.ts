import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma.js";
import { AppError, asyncHandler } from "@/middleware/errorHandler.js";
import { currentUserId, requireAuth } from "@/middleware/auth.js";
import { parseBody, routeId } from "@/lib/http.js";
import { approveList, editAppointment, extractAndStage, removeAppointment } from "./lists.service.js";
import { enqueueList, queueCapacity } from "@/modules/queue/queue.service.js";
import { extractionConfigured } from "@/modules/extraction/extraction.service.js";

export const listsRouter = Router();
listsRouter.use("/api/lists", requireAuth);

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];

const uploadSchema = z.object({
  municipalityId: z.number().int().positive(),
  agendaId: z.number().int().positive().nullish(),
  originalName: z.string().min(1),
  mimeType: z.string().min(1),
  /** Conteúdo do arquivo em base64. */
  fileBase64: z.string().min(1),
  isComplementary: z.boolean().optional(),
});

listsRouter.get(
  "/api/lists",
  asyncHandler(async (_req, res) => {
    const lists = await prisma.list.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        sourceFormat: true,
        status: true,
        isComplementary: true,
        extractionError: true,
        createdAt: true,
        approvedAt: true,
        dispatchedAt: true,
        municipality: { select: { id: true, name: true } },
        agenda: { select: { id: true, date: true } },
        uploadedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    });

    // Composição de cada lista pela faixa de status — mesmo formato que a
    // faixa de status usa no painel.
    const counts = await prisma.appointment.groupBy({
      by: ["listId", "status"],
      _count: { _all: true },
    });

    const byList = new Map<number, Record<string, number>>();
    for (const row of counts) {
      const entry = byList.get(row.listId) ?? {};
      entry[row.status] = row._count._all;
      byList.set(row.listId, entry);
    }

    res.json({
      lists: lists.map((list) => ({ ...list, counts: byList.get(list.id) ?? {} })),
      extractionConfigured,
    });
  })
);

listsRouter.post(
  "/api/lists",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, uploadSchema);

    if (!ACCEPTED_TYPES.includes(data.mimeType)) {
      throw new AppError("Envie um PDF ou uma foto (JPG, PNG ou WebP).", 400);
    }

    const fileData = Buffer.from(data.fileBase64, "base64");
    if (fileData.length === 0) throw new AppError("Arquivo vazio.", 400);
    if (fileData.length > MAX_UPLOAD_BYTES) {
      throw new AppError("Arquivo maior que 20 MB. Divida em partes.", 413);
    }

    const list = await prisma.list.create({
      data: {
        municipalityId: data.municipalityId,
        agendaId: data.agendaId ?? null,
        originalName: data.originalName,
        mimeType: data.mimeType,
        fileData,
        sizeBytes: fileData.length,
        isComplementary: data.isComplementary ?? false,
        uploadedById: currentUserId(req),
        status: extractionConfigured ? "EXTRAINDO" : "EM_REVISAO",
      },
    });

    res.status(201).json({ list: { id: list.id, status: list.status } });

    // A extração roda depois da resposta: leitura de PDF leva dezenas de
    // segundos e o navegador não precisa esperar. O painel acompanha pelo
    // status da lista.
    if (extractionConfigured) {
      extractAndStage(list.id).catch((err) =>
        console.error(`[LISTA ${list.id}] Falha na extração:`, (err as Error).message)
      );
    }
  })
);

/** Arquivo original, pra revisão lado a lado. */
listsRouter.get(
  "/api/lists/:id/file",
  asyncHandler(async (req, res) => {
    const list = await prisma.list.findUnique({
      where: { id: routeId(req) },
      select: { fileData: true, mimeType: true, originalName: true },
    });
    if (!list) throw new AppError("Lista não encontrada", 404);

    res.setHeader("Content-Type", list.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(list.originalName)}"`);
    res.send(Buffer.from(list.fileData));
  })
);

/** Lista com os agendamentos, pra tela de revisão. */
listsRouter.get(
  "/api/lists/:id",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const list = await prisma.list.findUnique({
      where: { id },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sourceFormat: true,
        status: true,
        extractionError: true,
        extractionRaw: true,
        createdAt: true,
        municipality: { select: { id: true, name: true } },
        agenda: { select: { id: true, date: true } },
      },
    });
    if (!list) throw new AppError("Lista não encontrada", 404);

    const appointments = await prisma.appointment.findMany({
      where: { listId: id },
      orderBy: { id: "asc" },
      include: {
        patient: { select: { id: true, name: true, cns: true, phones: true, optedOut: true } },
        doctor: { select: { id: true, name: true } },
        procedure: { select: { id: true, name: true } },
        requestingUnit: { select: { id: true, name: true } },
      },
    });

    const warnings =
      list.extractionRaw && typeof list.extractionRaw === "object" && "warnings" in list.extractionRaw
        ? ((list.extractionRaw as { warnings?: string[] }).warnings ?? [])
        : [];

    res.json({ list: { ...list, extractionRaw: undefined }, appointments, warnings });
  })
);

const editSchema = z.object({
  patientName: z.string().min(1).optional(),
  selectedPhone: z.string().nullish(),
  scheduledAt: z.string().datetime({ offset: true }).or(z.string().min(16)).optional(),
  doctorId: z.number().int().positive().optional(),
  procedureId: z.number().int().positive().optional(),
  isFirstVisit: z.boolean().nullish(),
});

listsRouter.patch(
  "/api/lists/appointments/:id",
  asyncHandler(async (req, res) => {
    const data = parseBody(req, editSchema);
    await editAppointment(routeId(req), data, currentUserId(req));
    res.json({ ok: true });
  })
);

listsRouter.delete(
  "/api/lists/appointments/:id",
  asyncHandler(async (req, res) => {
    await removeAppointment(routeId(req), currentUserId(req));
    res.status(204).end();
  })
);

listsRouter.post(
  "/api/lists/:id/reprocess",
  asyncHandler(async (req, res) => {
    const id = routeId(req);
    const list = await prisma.list.findUnique({ where: { id } });
    if (!list) throw new AppError("Lista não encontrada", 404);
    if (list.status !== "EM_REVISAO" && list.status !== "ERRO") {
      throw new AppError("Só dá pra reprocessar lista em revisão ou com erro.", 409);
    }

    await prisma.list.update({ where: { id }, data: { status: "EXTRAINDO", extractionError: null } });
    res.json({ ok: true });
    extractAndStage(id).catch((err) =>
      console.error(`[LISTA ${id}] Falha no reprocessamento:`, (err as Error).message)
    );
  })
);

listsRouter.post(
  "/api/lists/:id/approve",
  asyncHandler(async (req, res) => {
    await approveList(routeId(req), currentUserId(req));
    res.json({ ok: true });
  })
);

listsRouter.post(
  "/api/lists/:id/dispatch",
  asyncHandler(async (req, res) => {
    const result = await enqueueList(routeId(req), currentUserId(req));
    const capacity = await queueCapacity();
    res.json({ ...result, capacity });
  })
);
