import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/errorHandler.js";
import { requireAuth } from "@/middleware/auth.js";
import { dateOnlySchema, parseDateOnly, parseQuery } from "@/lib/http.js";
import {
  buildIndicators,
  buildIndicatorsCsvRows,
  getMessagesPerDay,
  getReceivedFlowBreakdown,
  type GroupBy,
} from "./indicators.service.js";
import { getCancellationReceivedBreakdown } from "@/modules/cancellations/cancellations.service.js";
import { toCsv } from "@/lib/csv.js";
import { buildListReportCsv } from "@/modules/lists/list-report.js";
import { generateListReportPdf } from "@/modules/lists/lists.pdf.js";

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
    const filters = buildFilters(query);
    const [report, byFlow, cancelamento] = await Promise.all([
      buildIndicators(filters, query.groupBy as GroupBy),
      getReceivedFlowBreakdown(filters),
      getCancellationReceivedBreakdown(filters.from, filters.to, filters),
    ]);
    res.json({ ...report, receivedBreakdown: { ...byFlow, cancelamento } });
  })
);

const messagesPerDaySchema = z.object({ from: dateOnlySchema, to: dateOnlySchema });

/** Série pro gráfico de colunas "Mensagens enviadas por dia" em Indicadores. */
indicatorsRouter.get(
  "/api/indicators/messages-per-day",
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, messagesPerDaySchema);
    const from = parseDateOnly(query.from);
    const to = new Date(parseDateOnly(query.to).getTime() + 86_400_000 - 1);
    const series = await getMessagesPerDay(from, to);
    res.json({ series });
  })
);

indicatorsRouter.get(
  "/api/indicators/export",
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, filterSchema);
    const report = await buildIndicators(buildFilters(query), query.groupBy as GroupBy);
    const { header, rows } = buildIndicatorsCsvRows(report);
    const csv = toCsv(header, rows);

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
    const { csv, filename } = await buildListReportCsv(query.listId);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  })
);

/**
 * Mesmo relatório, em PDF — agrupado por situação, com legenda e cabeçalho
 * profissional (pedido do usuário em 2026-08-27, mesmo "tempero" do PDF de
 * Cancelamento). Botão "Exportar PDF" na Revisão, ao lado do "Exportar CSV".
 */
indicatorsRouter.get(
  "/api/indicators/list-report-pdf",
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, z.object({ listId: z.coerce.number().int().positive() }));
    const { pdf, filename } = await generateListReportPdf(query.listId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdf);
  })
);
