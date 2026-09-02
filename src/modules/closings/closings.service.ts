import { prisma } from "@/lib/prisma.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";
import { AppError } from "@/middleware/errorHandler.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { toBrasiliaDateString } from "@/lib/timezone.js";
import { buildAlerts } from "./closings.alerts.js";

/*
  Conciliação em 3 checagens de um mesmo dia:

    1. Confirmados — automático, das respostas do WhatsApp. Nunca digitado.
    2. Atendidos   — o que o médico informou. A equipe digita.
    3. Pagos       — o que o financeiro conferiu nas guias. Vira pagamento.

  Só 2 e 3 são lançamento manual, e por isso guardam quem lançou e quando,
  além da entrada no audit_logs. As contagens do check 1 são sempre
  calculadas — não existe coluna pra elas.
*/

export interface ClosingRow {
  doctorId: number;
  doctorName: string;
  municipalityId: number;
  municipalityName: string;
  procedureId: number | null;
  procedureName: string | null;
  date: string;
  /** Check 1, derivado. */
  planned: number;
  confirmed: number;
  refused: number;
  noAnswer: number;
  unreachable: number;
  /** Checks 2 e 3, lançados. */
  closingId: number | null;
  attendedReported: number | null;
  attendedReportedBy: string | null;
  paidCount: number | null;
  paidCountBy: string | null;
  extrasCount: number;
  notes: string | null;
  /** Inconsistências que precisam de atenção. */
  alerts: string[];
}

// Duas funções, de propósito — misturar as duas era o bug (achado em
// 2026-08-26, mesma classe do horário 3h errado): `appointment.scheduledAt`
// é timestamp de verdade (precisa do dia local em Brasília, ver
// toBrasiliaDateString), `closing.date` é `@db.Date` (já é meia-noite UTC
// do dia certo — ler local dependeria do fuso do processo, que já provou
// não ser confiável; lê UTC direto).
function closingDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

/** Grade do fechamento: uma linha por médico × município × procedimento × dia. */
export async function listClosings(from: Date, to: Date): Promise<ClosingRow[]> {
  const appointments = await prisma.appointment.findMany({
    where: { scheduledAt: { gte: from, lte: to } },
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

  const groups = new Map<string, Omit<ClosingRow, "alerts">>();

  for (const appointment of appointments) {
    const date = toBrasiliaDateString(appointment.scheduledAt);
    const key = `${appointment.doctorId}|${appointment.municipalityId}|${appointment.procedureId}|${date}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        doctorId: appointment.doctorId,
        doctorName: appointment.doctor.name,
        municipalityId: appointment.municipalityId,
        municipalityName: appointment.municipality.name,
        procedureId: appointment.procedureId,
        procedureName: appointment.procedure.name,
        date,
        planned: 0,
        confirmed: 0,
        refused: 0,
        noAnswer: 0,
        unreachable: 0,
        closingId: null,
        attendedReported: null,
        attendedReportedBy: null,
        paidCount: null,
        paidCountBy: null,
        extrasCount: 0,
        notes: null,
      };
      groups.set(key, group);
    }

    group.planned++;
    if (appointment.status === "CONFIRMADO") group.confirmed++;
    else if (appointment.status === "RECUSADO") group.refused++;
    else if (appointment.status === "SEM_TELEFONE") group.unreachable++;
    else if (appointment.status === "SEM_RESPOSTA" || appointment.status === "FALHA") group.noAnswer++;
  }

  const closings = await prisma.dailyClosing.findMany({
    where: { date: { gte: from, lte: to } },
    include: {
      attendedReportedBy: { select: { name: true } },
      paidCountBy: { select: { name: true } },
    },
  });

  for (const closing of closings) {
    const key = `${closing.doctorId}|${closing.municipalityId}|${closing.procedureId}|${closingDateKey(closing.date)}`;
    const group = groups.get(key);
    if (!group) continue;
    group.closingId = closing.id;
    group.attendedReported = closing.attendedReported;
    group.attendedReportedBy = closing.attendedReportedBy?.name ?? null;
    group.paidCount = closing.paidCount;
    group.paidCountBy = closing.paidCountBy?.name ?? null;
    group.extrasCount = closing.extrasCount;
    group.notes = closing.notes;
  }

  return Array.from(groups.values())
    .map((group) => ({ ...group, alerts: buildAlerts(group) }))
    .sort((a, b) => (a.date === b.date ? a.doctorName.localeCompare(b.doctorName) : b.date.localeCompare(a.date)));
}

export interface ClosingInput {
  doctorId: number;
  municipalityId: number;
  procedureId: number | null;
  date: Date;
  attendedReported?: number | null;
  paidCount?: number | null;
  extrasCount?: number;
  notes?: string | null;
}

/** Lança ou corrige os checks 2 e 3. Cada campo carrega autoria e horário. */
export async function saveClosing(input: ClosingInput, userId: number) {
  // findFirst em vez de findUnique: a unicidade é garantida por dois índices
  // parciais no banco (ver migration), não por um @@unique do Prisma — o
  // procedureId nulável impede o índice único comum de funcionar.
  const before = await prisma.dailyClosing.findFirst({
    where: {
      doctorId: input.doctorId,
      municipalityId: input.municipalityId,
      date: input.date,
      procedureId: input.procedureId,
    },
  });

  if (input.attendedReported != null && input.attendedReported < 0) {
    throw new AppError("Atendidos não pode ser negativo.", 400);
  }
  if (input.paidCount != null && input.paidCount < 0) {
    throw new AppError("Guias não pode ser negativo.", 400);
  }

  const now = new Date();
  const attendedChanged = input.attendedReported !== undefined && input.attendedReported !== before?.attendedReported;
  const paidChanged = input.paidCount !== undefined && input.paidCount !== before?.paidCount;

  const data = {
    attendedReported: input.attendedReported,
    ...(attendedChanged ? { attendedReportedById: userId, attendedReportedAt: now } : {}),
    paidCount: input.paidCount,
    ...(paidChanged ? { paidCountById: userId, paidCountAt: now } : {}),
    extrasCount: input.extrasCount,
    notes: input.notes,
  };

  const closing = before
    ? await prisma.dailyClosing.update({ where: { id: before.id }, data })
    : await prisma.dailyClosing.create({
        data: {
          clientId: requireActiveClientId(),
          doctorId: input.doctorId,
          municipalityId: input.municipalityId,
          procedureId: input.procedureId,
          date: input.date,
          ...data,
        },
      });

  if (attendedChanged) {
    await recordAudit({
      userId,
      action: "closing_attended",
      entity: "DailyClosing",
      entityId: closing.id,
      field: "attendedReported",
      oldValue: before?.attendedReported ?? null,
      newValue: input.attendedReported ?? null,
    });
  }
  if (paidChanged) {
    await recordAudit({
      userId,
      action: "closing_paid",
      entity: "DailyClosing",
      entityId: closing.id,
      field: "paidCount",
      oldValue: before?.paidCount ?? null,
      newValue: input.paidCount ?? null,
    });
  }

  return closing;
}
