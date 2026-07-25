import { prisma } from "@/lib/prisma.js";

/*
  Indicadores, com as fórmulas fixadas no PLANO.md:

    % Confirmação    = confirmados ÷ contatáveis   (eficácia do disparo)
    % Comparecimento = atendidos ÷ confirmados     (no-show de quem disse sim)
    % Aproveitamento = atendidos ÷ planejados      (visão da secretaria)
    Divergência      = pagos ÷ atendidos           (médico × guias)

  "Contatáveis" exclui quem não tem telefone: cobrar do disparo um paciente
  que nunca poderia receber mensagem distorceria a leitura, e a lista de não
  contatáveis já volta pra secretaria por outro caminho.
*/

export interface IndicatorFilters {
  from: Date;
  to: Date;
  doctorId?: number;
  municipalityId?: number;
  procedureId?: number;
}

export interface IndicatorTotals {
  planned: number;
  contactable: number;
  confirmed: number;
  refused: number;
  noAnswer: number;
  unreachable: number;
  attended: number | null;
  paid: number | null;
  extras: number;
  /** null quando não há base para calcular — nunca 0 disfarçado. */
  confirmationRate: number | null;
  attendanceRate: number | null;
  utilizationRate: number | null;
  divergenceRate: number | null;
  doctorPayout: number | null;
  cityBilling: number | null;
  margin: number | null;
}

export interface IndicatorBreakdown extends IndicatorTotals {
  key: string;
  label: string;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function emptyTotals(): IndicatorTotals {
  return {
    planned: 0,
    contactable: 0,
    confirmed: 0,
    refused: 0,
    noAnswer: 0,
    unreachable: 0,
    attended: null,
    paid: null,
    extras: 0,
    confirmationRate: null,
    attendanceRate: null,
    utilizationRate: null,
    divergenceRate: null,
    doctorPayout: null,
    cityBilling: null,
    margin: null,
  };
}

function finalize(totals: IndicatorTotals): IndicatorTotals {
  return {
    ...totals,
    confirmationRate: rate(totals.confirmed, totals.contactable),
    attendanceRate: totals.attended === null ? null : rate(totals.attended, totals.confirmed),
    utilizationRate: totals.attended === null ? null : rate(totals.attended, totals.planned),
    divergenceRate:
      totals.paid === null || totals.attended === null ? null : rate(totals.paid, totals.attended),
  };
}

export type GroupBy = "doctor" | "municipality" | "procedure" | "month";

export interface IndicatorReport {
  totals: IndicatorTotals;
  breakdown: IndicatorBreakdown[];
}

export async function buildIndicators(
  filters: IndicatorFilters,
  groupBy: GroupBy
): Promise<IndicatorReport> {
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
  const feeMap = new Map(
    fees.map((fee) => [
      `${fee.doctorId}|${fee.procedureId}`,
      { doctorFee: Number(fee.doctorFee ?? 0), cityRate: Number(fee.cityRate ?? 0) },
    ])
  );

  const totals = emptyTotals();
  const groups = new Map<string, IndicatorBreakdown>();

  function bucketFor(item: {
    doctorId: number;
    municipalityId: number;
    procedureId: number | null;
    date: Date;
    doctorName: string;
    municipalityName: string;
    procedureName: string | null;
  }): IndicatorBreakdown {
    let key: string;
    let label: string;
    if (groupBy === "doctor") {
      key = `d${item.doctorId}`;
      label = item.doctorName;
    } else if (groupBy === "municipality") {
      key = `m${item.municipalityId}`;
      label = item.municipalityName;
    } else if (groupBy === "procedure") {
      key = `p${item.procedureId ?? 0}`;
      label = item.procedureName ?? "Não informado";
    } else {
      const month = `${item.date.getFullYear()}-${String(item.date.getMonth() + 1).padStart(2, "0")}`;
      key = month;
      label = month;
    }

    let group = groups.get(key);
    if (!group) {
      group = { key, label, ...emptyTotals() };
      groups.set(key, group);
    }
    return group;
  }

  for (const appointment of appointments) {
    const group = bucketFor({
      doctorId: appointment.doctorId,
      municipalityId: appointment.municipalityId,
      procedureId: appointment.procedureId,
      date: appointment.scheduledAt,
      doctorName: appointment.doctor.name,
      municipalityName: appointment.municipality.name,
      procedureName: appointment.procedure.name,
    });

    for (const target of [totals, group]) {
      target.planned++;
      if (appointment.status === "SEM_TELEFONE") target.unreachable++;
      else target.contactable++;

      if (appointment.status === "CONFIRMADO") target.confirmed++;
      else if (appointment.status === "RECUSADO") target.refused++;
      else if (appointment.status === "SEM_RESPOSTA" || appointment.status === "FALHA") target.noAnswer++;
    }
  }

  for (const closing of closings) {
    const group = bucketFor({
      doctorId: closing.doctorId,
      municipalityId: closing.municipalityId,
      procedureId: closing.procedureId,
      date: closing.date,
      doctorName: closing.doctor.name,
      municipalityName: closing.municipality.name,
      procedureName: closing.procedure?.name ?? null,
    });

    const fee = feeMap.get(`${closing.doctorId}|${closing.procedureId}`);

    for (const target of [totals, group]) {
      if (closing.attendedReported !== null) {
        target.attended = (target.attended ?? 0) + closing.attendedReported;
      }
      if (closing.paidCount !== null) {
        target.paid = (target.paid ?? 0) + closing.paidCount;
        // Financeiro segue o check 3: paga-se o que a guia comprova, não o
        // que o médico informou.
        if (fee) {
          target.doctorPayout = (target.doctorPayout ?? 0) + closing.paidCount * fee.doctorFee;
          target.cityBilling = (target.cityBilling ?? 0) + closing.paidCount * fee.cityRate;
        }
      }
      target.extras += closing.extrasCount;
    }
  }

  function withMargin(item: IndicatorTotals): IndicatorTotals {
    const finalized = finalize(item);
    return {
      ...finalized,
      margin:
        finalized.cityBilling === null || finalized.doctorPayout === null
          ? null
          : finalized.cityBilling - finalized.doctorPayout,
    };
  }

  return {
    totals: withMargin(totals),
    breakdown: Array.from(groups.values())
      .map((group) => ({ ...group, ...withMargin(group) }))
      .sort((a, b) => b.planned - a.planned),
  };
}
