import { prisma } from "@/lib/prisma.js";
import { buildIndicatorsCore, type GroupBy, type IndicatorReport } from "./indicators.js";

export type { GroupBy, IndicatorReport, IndicatorTotals, IndicatorBreakdown } from "./indicators.js";

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
