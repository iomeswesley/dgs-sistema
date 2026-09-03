import { prisma } from "@/lib/prisma.js";
import { toBrasiliaDateString } from "@/lib/timezone.js";
import {
  buildIndicatorsCore,
  buildMessagesPerDaySeries,
  buildReceivedFlowBreakdown,
  type DailyMessageCount,
  type GroupBy,
  type IndicatorReport,
  type ReceivedFlowBreakdown,
  type TemplateKindKey,
} from "./indicators.js";

export type {
  GroupBy,
  IndicatorReport,
  IndicatorTotals,
  IndicatorBreakdown,
  DailyMessageCount,
  ReceivedFlowBreakdown,
  StatusCounts,
} from "./indicators.js";

export interface IndicatorFilters {
  from: Date;
  to: Date;
  doctorId?: number;
  municipalityId?: number;
  procedureId?: number;
}

/** Busca agendamentos, fechamentos e valores no banco; o cálculo em si é puro — ver `indicators.ts`. */
export async function buildIndicators(filters: IndicatorFilters, groupBy: GroupBy): Promise<IndicatorReport> {
  const where = {
    scheduledAt: { gte: filters.from, lte: filters.to },
    doctorId: filters.doctorId,
    municipalityId: filters.municipalityId,
    procedureId: filters.procedureId,
    // Cancelado pela DGS (médico indisponível) não passou pelo fluxo de
    // confirmação normal — nunca teve chance real de virar "confirmado".
    // Contar como "planejado" infla o denominador e derruba a taxa de
    // confirmação artificialmente (achado pelo usuário em 2026-08-29: agenda
    // do Dr. Edvaldo mostrando "110 planejados, 1 confirmado" — os outros
    // 109 eram de uma agenda cancelada, não confirmações perdidas de verdade).
    status: { not: "CANCELADO" as const },
  };

  const appointments = await prisma.appointment.findMany({
    where,
    select: {
      id: true,
      doctorId: true,
      municipalityId: true,
      procedureId: true,
      scheduledAt: true,
      status: true,
      contactedById: true,
      doctor: { select: { name: true } },
      municipality: { select: { name: true } },
      procedure: { select: { name: true } },
      list: { select: { isComplementary: true } },
    },
  });

  // Quem teve pelo menos 1 envio de verdade do template CONFIRMACAO —
  // achado em 2026-09-03 (ver comentário em indicators.ts): sem isso, a
  // "% Confirmação" contava agendamento que nunca foi nem tentado
  // (PENDENTE, lista ainda não disparada) no mesmo denominador de
  // confirmação perdida de verdade.
  const confirmationSentIds = new Set(
    (
      await prisma.whatsappMessage.findMany({
        where: {
          direction: "ENVIADA",
          template: "CONFIRMACAO",
          appointmentId: { in: appointments.map((a) => a.id) },
        },
        select: { appointmentId: true },
        distinct: ["appointmentId"],
      })
    ).map((m) => m.appointmentId)
  );

  const closings = await prisma.dailyClosing.findMany({
    where: {
      date: { gte: filters.from, lte: filters.to },
      doctorId: filters.doctorId,
      municipalityId: filters.municipalityId,
      procedureId: filters.procedureId,
    },
    include: {
      doctor: { select: { name: true } },
      municipality: { select: { name: true } },
      procedure: { select: { name: true } },
    },
  });

  // Valores por médico × procedimento, pra calcular repasse e faturamento.
  const fees = await prisma.doctorProcedure.findMany({
    select: { doctorId: true, procedureId: true, doctorFee: true, cityRate: true },
  });

  return buildIndicatorsCore(
    appointments.map((appointment) => ({
      doctorId: appointment.doctorId,
      municipalityId: appointment.municipalityId,
      procedureId: appointment.procedureId,
      scheduledAt: appointment.scheduledAt,
      status: appointment.status,
      doctorName: appointment.doctor.name,
      municipalityName: appointment.municipality.name,
      procedureName: appointment.procedure.name,
      isComplementary: appointment.list?.isComplementary ?? false,
      confirmationTemplateSent: confirmationSentIds.has(appointment.id),
      manuallyContacted: appointment.contactedById !== null,
    })),
    closings.map((closing) => ({
      doctorId: closing.doctorId,
      municipalityId: closing.municipalityId,
      procedureId: closing.procedureId,
      date: closing.date,
      doctorName: closing.doctor.name,
      municipalityName: closing.municipality.name,
      procedureName: closing.procedure?.name ?? null,
      attendedReported: closing.attendedReported,
      paidCount: closing.paidCount,
      extrasCount: closing.extrasCount,
    })),
    fees.map((fee) => ({
      doctorId: fee.doctorId,
      procedureId: fee.procedureId,
      doctorFee: fee.doctorFee ? Number(fee.doctorFee) : null,
      cityRate: fee.cityRate ? Number(fee.cityRate) : null,
    })),
    groupBy
  );
}

/**
 * Desfecho de quem recebeu mensagem, por fluxo (confirmação de consulta vs.
 * reposição de vaga) — pro gráfico "mensagens recebidas" de Indicadores
 * (pedido do usuário em 2026-09-03). Mesmo filtro de `buildIndicators`
 * (exclui CANCELADO — nunca teve chance real de responder), consulta
 * enxuta, só os 2 campos que `buildReceivedFlowBreakdown` usa.
 */
export async function getReceivedFlowBreakdown(filters: IndicatorFilters): Promise<ReceivedFlowBreakdown> {
  const appointments = await prisma.appointment.findMany({
    where: {
      scheduledAt: { gte: filters.from, lte: filters.to },
      doctorId: filters.doctorId,
      municipalityId: filters.municipalityId,
      procedureId: filters.procedureId,
      status: { not: "CANCELADO" },
    },
    select: { status: true, list: { select: { isComplementary: true } } },
  });

  return buildReceivedFlowBreakdown(
    appointments.map((a) => ({ status: a.status, isComplementary: a.list?.isComplementary ?? false }))
  );
}

/**
 * Série de mensagens ENVIADAS por dia, pro gráfico de colunas em Indicadores
 * — busca só o timestamp (não o conteúdo, nem o telefone) de cada envio no
 * intervalo, agrega em Brasília. `to` já vem como fim do dia (23:59:59.999),
 * mesmo padrão do `buildFilters` em indicators.routes.ts.
 */
export async function getMessagesPerDay(from: Date, to: Date): Promise<DailyMessageCount[]> {
  const messages = await prisma.whatsappMessage.findMany({
    where: { direction: "ENVIADA", createdAt: { gte: from, lte: to } },
    select: { createdAt: true, template: true },
  });

  return buildMessagesPerDaySeries(
    messages.map((m) => ({ dayKey: toBrasiliaDateString(m.createdAt), template: m.template as TemplateKindKey | null })),
    toBrasiliaDateString(from),
    toBrasiliaDateString(to)
  );
}

function percentCell(value: number | null): string {
  return value === null ? "" : `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

function moneyCell(value: number | null): string {
  return value === null ? "" : value.toFixed(2).replace(".", ",");
}

/**
 * Linhas do CSV de exportação — extraído de indicators.routes.ts pra ser
 * reaproveitado também pelo export de admin (indicadores de outro cliente,
 * ver admin.routes.ts), sem duplicar a lista de colunas nos dois lugares.
 */
export function buildIndicatorsCsvRows(report: IndicatorReport): { header: string[]; rows: (string | number)[][] } {
  return {
    header: [
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
      "Templates de confirmação enviados",
      "Confirmados (fluxo de confirmação)",
      "% Confirmação",
      "% Comparecimento",
      "% Aproveitamento",
      "Divergência",
      "Repasse ao médico",
      "Faturamento",
      "Margem",
    ],
    rows: report.breakdown.map((row) => [
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
      row.confirmationBase,
      row.confirmationConfirmed,
      percentCell(row.confirmationRate),
      percentCell(row.attendanceRate),
      percentCell(row.utilizationRate),
      percentCell(row.divergenceRate),
      moneyCell(row.doctorPayout),
      moneyCell(row.cityBilling),
      moneyCell(row.margin),
    ]),
  };
}
