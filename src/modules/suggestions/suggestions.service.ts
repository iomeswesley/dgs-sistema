import { prisma } from "@/lib/prisma.js";
import {
  estimateAttendanceRate,
  suggestConfirmations,
  type HistorySample,
  type Suggestion,
} from "./suggestions.js";

/*
  Busca o histórico que alimenta a sugestão de confirmações.

  A taxa vem dos fechamentos já lançados: confirmados apurados pelo sistema
  contra atendidos informados pelo médico. Encaixes ficam de fora do
  numerador de propósito — eles não vieram de confirmação, então inflariam a
  taxa e fariam o sistema sugerir menos gente do que o necessário.
*/

/** Quantas semanas de histórico entram no cálculo. */
const HISTORY_WEEKS = 12;

function historyStart(): Date {
  const date = new Date();
  date.setDate(date.getDate() - HISTORY_WEEKS * 7);
  return date;
}

async function sampleFor(where: {
  doctorId?: number;
  procedureId?: number;
  municipalityId?: number;
}): Promise<HistorySample> {
  const closings = await prisma.dailyClosing.findMany({
    where: { ...where, date: { gte: historyStart() }, attendedReported: { not: null } },
    select: {
      doctorId: true,
      municipalityId: true,
      procedureId: true,
      date: true,
      attendedReported: true,
      extrasCount: true,
    },
  });

  if (closings.length === 0) return { confirmed: 0, attended: 0 };

  let attended = 0;
  for (const closing of closings) {
    // Só o que veio de confirmação conta; encaixe não passou pela fila.
    attended += Math.max(0, (closing.attendedReported ?? 0) - closing.extrasCount);
  }

  // Confirmados do mesmo recorte e período.
  const confirmed = await prisma.appointment.count({
    where: {
      ...where,
      status: "CONFIRMADO",
      scheduledAt: { gte: historyStart() },
    },
  });

  return { confirmed, attended };
}

export interface ListSuggestion extends Suggestion {
  doctorName: string;
  procedureName: string | null;
  expectedPerDay: number;
}

/**
 * Sugestão para uma lista: quantas confirmações buscar para fechar a agenda
 * do médico. Devolve null quando não há capacidade cadastrada — sem
 * `expectedPerDay` não existe alvo, e chutar um seria pior que não sugerir.
 */
export async function suggestionForList(listId: number): Promise<ListSuggestion | null> {
  const appointments = await prisma.appointment.findMany({
    where: { listId },
    select: {
      doctorId: true,
      procedureId: true,
      municipalityId: true,
      status: true,
      doctor: { select: { name: true } },
      procedure: { select: { name: true } },
    },
  });
  if (appointments.length === 0) return null;

  // A lista pode ter mais de um médico; a sugestão usa o dominante, que é o
  // caso real (uma lista = uma agenda de um profissional).
  const counts = new Map<string, number>();
  for (const appointment of appointments) {
    const key = `${appointment.doctorId}|${appointment.procedureId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [dominantKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!dominantKey) return null;

  const [doctorIdText, procedureIdText] = dominantKey.split("|");
  const doctorId = Number(doctorIdText);
  const procedureId = Number(procedureIdText);
  const sample = appointments.find(
    (appointment) => appointment.doctorId === doctorId && appointment.procedureId === procedureId
  );

  const config = await prisma.doctorProcedure.findUnique({
    where: { doctorId_procedureId: { doctorId, procedureId } },
  });
  if (!config?.expectedPerDay) return null;

  const [doctorProcedure, doctor, municipality, global] = await Promise.all([
    sampleFor({ doctorId, procedureId }),
    sampleFor({ doctorId }),
    sampleFor({ municipalityId: sample?.municipalityId }),
    sampleFor({}),
  ]);

  const estimate = estimateAttendanceRate({ doctorProcedure, doctor, municipality, global });
  const confirmationsSoFar = appointments.filter(
    (appointment) => appointment.status === "CONFIRMADO"
  ).length;

  return {
    ...suggestConfirmations({
      expectedPerDay: config.expectedPerDay,
      confirmationsSoFar,
      estimate,
    }),
    doctorName: sample?.doctor.name ?? "",
    procedureName: sample?.procedure.name ?? null,
    expectedPerDay: config.expectedPerDay,
  };
}

/*
  Score de no-show por paciente: NÃO implementado, de propósito.

  O plano previa, mas o dado não existe. O médico informa um total de
  atendidos por dia (check 2), não a lista de quem compareceu — então não há
  como saber se um paciente específico confirmou e faltou. Qualquer score
  aqui seria uma aproximação apresentada como fato, num sistema onde o
  número vira pagamento.

  Para viabilizar seria preciso registrar presença por paciente, o que muda
  o combinado com os médicos. A função pura `noShowScore` em
  ./suggestions.ts já está pronta e testada para quando esse dado existir.
*/
