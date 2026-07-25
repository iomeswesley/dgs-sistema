import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma.js";
import { asyncHandler } from "@/middleware/errorHandler.js";
import { requireAuth } from "@/middleware/auth.js";
import { dateOnlySchema, parseDateOnly, parseQuery } from "@/lib/http.js";
import { buildIndicators, type GroupBy } from "./indicators.service.js";
import { toCsv } from "@/lib/csv.js";

export const indicatorsRouter = Router();
indicatorsRouter.use("/api/indicators", requireAuth);

const filterSchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  groupBy: z.enum(["doctor", "municipality", "procedure", "month"]).default("doctor"),
  doctorId: z.coerce.number().int().positive().optional(),
  municipalityId: z.coerce.number().int().positive().optional(),
  procedureId: z.coerce.number().int().positive().optional(),
});

function buildFilters(query: z.infer<typeof filterSchema>) {
  return {
    from: parseDateOnly(query.from),
    to: new Date(parseDateOnly(query.to).getTime() + 86_400_000 - 1),
    doctorId: query.doctorId,
    municipalityId: query.municipalityId,
    procedureId: query.procedureId,
  };
}

indicatorsRouter.get(
  "/api/indicators",
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, filterSchema);
    const report = await buildIndicators(buildFilters(query), query.groupBy as GroupBy);
    res.json(report);
  })
);

function percent(value: number | null): string {
  return value === null ? "" : `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

function money(value: number | null): string {
  return value === null ? "" : value.toFixed(2).replace(".", ",");
}

indicatorsRouter.get(
  "/api/indicators/export",
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, filterSchema);
    const report = await buildIndicators(buildFilters(query), query.groupBy as GroupBy);

    const csv = toCsv(
      [
        "Recorte",
        "Planejados",
        "Contatáveis",
        "Confirmados",
        "Recusados",
        "Sem resposta",
        "Sem telefone",
        "Atendidos",
        "Encaixes",
        "Pagos",
        "% Confirmação",
        "% Comparecimento",
        "% Aproveitamento",
        "Divergência",
        "Repasse ao médico",
        "Faturamento",
        "Margem",
      ],
      report.breakdown.map((row) => [
        row.label,
        row.planned,
        row.contactable,
        row.confirmed,
        row.refused,
        row.noAnswer,
        row.unreachable,
        row.attended ?? "",
        row.extras,
        row.paid ?? "",
        percent(row.confirmationRate),
        percent(row.attendanceRate),
        percent(row.utilizationRate),
        percent(row.divergenceRate),
        money(row.doctorPayout),
        money(row.cityBilling),
        money(row.margin),
      ])
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="indicadores-${query.from}-a-${query.to}.csv"`);
    res.send(csv);
  })
);

/**
 * Relatório de uma lista para devolver à secretaria: nome, telefone e o que
 * cada paciente respondeu, com o motivo quando recusou.
 */
indicatorsRouter.get(
  "/api/indicators/list-report",
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, z.object({ listId: z.coerce.number().int().positive() }));

    const appointments = await prisma.appointment.findMany({
      where: { listId: query.listId },
      orderBy: { scheduledAt: "asc" },
      include: {
        patient: { select: { name: true, cns: true } },
        doctor: { select: { name: true } },
        procedure: { select: { name: true } },
      },
    });

    const STATUS_LABEL: Record<string, string> = {
      PENDENTE: "Não enviado",
      ENVIADO: "Enviado, sem resposta",
      ENTREGUE: "Entregue, sem resposta",
      CONFIRMADO: "Confirmou",
      RECUSADO: "Recusou",
      SEM_RESPOSTA: "Sem resposta",
      SEM_TELEFONE: "Não contatável (sem telefone)",
      FALHA: "Falha na entrega",
    };
    const REASON_LABEL: Record<string, string> = {
      JA_FEZ: "Já fez o procedimento",
      HORARIO_RUIM: "Horário não serve",
      SEM_TRANSPORTE: "Sem transporte",
      MUDOU_SE: "Mudou-se",
      TELEFONE_ERRADO: "Telefone errado",
      OBITO: "Óbito",
      OUTRO: "Outro",
    };

    const csv = toCsv(
      ["Paciente", "CNS", "Data/Hora", "Procedimento", "Médico", "Situação", "Motivo", "Observação"],
      appointments.map((appointment) => [
        appointment.patient.name,
        appointment.patient.cns ?? "",
        appointment.scheduledAt.toLocaleString("pt-BR"),
        appointment.procedure.name,
        appointment.doctor.name,
        STATUS_LABEL[appointment.status] ?? appointment.status,
        appointment.refusalReason ? (REASON_LABEL[appointment.refusalReason] ?? "") : "",
        appointment.refusalNote ?? appointment.contactNote ?? "",
      ])
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="lista-${query.listId}.csv"`);
    res.send(csv);
  })
);
