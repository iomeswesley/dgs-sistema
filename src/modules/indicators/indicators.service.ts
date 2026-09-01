import { prisma } from "@/lib/prisma.js";
import { toBrasiliaDateString } from "@/lib/timezone.js";
import { buildIndicatorsCore, buildMessagesPerDaySeries, type DailyMessageCount, type GroupBy, type IndicatorReport } from "./indicators.js";

export type { GroupBy, IndicatorReport, IndicatorTotals, IndicatorBreakdown, DailyMessageCount } from "./indicators.js";

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
      doctorId: true,
      municipalityId: true,
      procedureId: true,
      scheduledAt: true,
      status: true,
      doctor: { select: { name: true } },
      municipality: { select: { name: true } },
      procedure: { select: { name: true } },
    },
  });

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
 * Série de mensagens ENVIADAS por dia, pro gráfico de colunas em Indicadores
 * — busca só o timestamp (não o conteúdo, nem o telefone) de cada envio no
 * intervalo, agrega em Brasília. `to` já vem como fim do dia (23:59:59.999),
 * mesmo padrão do `buildFilters` em indicators.routes.ts.
 */
export async function getMessagesPerDay(from: Date, to: Date): Promise<DailyMessageCount[]> {
  const messages = await prisma.whatsappMessage.findMany({
    where: { direction: "ENVIADA", createdAt: { gte: from, lte: to } },
    select: { createdAt: true },
  });

  return buildMessagesPerDaySeries(
    messages.map((m) => toBrasiliaDateString(m.createdAt)),
    toBrasiliaDateString(from),
    toBrasiliaDateString(to)
  );
}
