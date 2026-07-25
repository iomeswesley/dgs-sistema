/*
  Sugestão de confirmações e score de no-show.

  Módulo puro — sem banco, sem env — porque é a regra que decide quantos
  pacientes a secretaria precisa mandar, e errar aqui significa médico
  ocioso (chamou pouco) ou sala lotada (chamou demais).

  A ideia: se historicamente 78% de quem confirma realmente aparece, para
  fechar 20 atendimentos é preciso ~26 confirmações.
*/

/** Abaixo disso a amostra é pequena demais para confiar na taxa. */
export const MIN_SAMPLE = 20;

/** Usado quando não há histórico suficiente em nenhum nível. */
export const FALLBACK_ATTENDANCE_RATE = 0.8;

export interface HistorySample {
  confirmed: number;
  attended: number;
}

export type ConfidenceLevel = "doctor_procedure" | "doctor" | "municipality" | "global" | "fallback";

export interface AttendanceEstimate {
  rate: number;
  /** De onde veio a taxa — quanto mais específico, mais confiável. */
  basis: ConfidenceLevel;
  sampleSize: number;
}

/**
 * Escolhe a taxa de comparecimento mais específica com amostra suficiente.
 *
 * A cascata importa: a taxa daquele médico naquele procedimento é bem mais
 * preditiva que a média geral, mas só vale se houver histórico bastante.
 */
export function estimateAttendanceRate(samples: {
  doctorProcedure?: HistorySample;
  doctor?: HistorySample;
  municipality?: HistorySample;
  global?: HistorySample;
}): AttendanceEstimate {
  const cascade: [ConfidenceLevel, HistorySample | undefined][] = [
    ["doctor_procedure", samples.doctorProcedure],
    ["doctor", samples.doctor],
    ["municipality", samples.municipality],
    ["global", samples.global],
  ];

  for (const [basis, sample] of cascade) {
    if (!sample || sample.confirmed < MIN_SAMPLE) continue;
    // Taxa acima de 1 acontece quando há encaixe misturado no fechamento;
    // limitar evita sugerir menos confirmações do que a capacidade.
    const rate = Math.min(1, sample.attended / sample.confirmed);
    if (rate <= 0) continue;
    return { rate, basis, sampleSize: sample.confirmed };
  }

  return { rate: FALLBACK_ATTENDANCE_RATE, basis: "fallback", sampleSize: 0 };
}

export interface Suggestion {
  /** Quantas confirmações buscar para fechar a agenda. */
  confirmationsNeeded: number;
  /** Quantas já foram obtidas nesta lista. */
  confirmationsSoFar: number;
  /** Quantas ainda faltam. Zero quando a agenda já está coberta. */
  stillNeeded: number;
  estimate: AttendanceEstimate;
  /** Frase pronta para a tela — evita a equipe interpretar número solto. */
  explanation: string;
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Quantas confirmações são necessárias para fechar `expectedPerDay`
 * atendimentos, dada a taxa histórica de comparecimento.
 */
export function suggestConfirmations(input: {
  expectedPerDay: number;
  confirmationsSoFar: number;
  estimate: AttendanceEstimate;
}): Suggestion {
  const { expectedPerDay, confirmationsSoFar, estimate } = input;

  const confirmationsNeeded = Math.ceil(expectedPerDay / estimate.rate);
  const stillNeeded = Math.max(0, confirmationsNeeded - confirmationsSoFar);

  const basisText =
    estimate.basis === "fallback"
      ? "sem histórico suficiente, usando 80% como referência"
      : `taxa histórica de ${percent(estimate.rate)} (${estimate.sampleSize} confirmações)`;

  const explanation =
    stillNeeded === 0
      ? `Agenda coberta: ${confirmationsSoFar} confirmações para ${expectedPerDay} atendimentos esperados (${basisText}).`
      : `Para fechar ${expectedPerDay} atendimentos, busque ~${confirmationsNeeded} confirmações — ${basisText}. Faltam ${stillNeeded}.`;

  return { confirmationsNeeded, confirmationsSoFar, stillNeeded, estimate, explanation };
}

export interface PatientHistory {
  confirmedCount: number;
  attendedCount: number;
  noShowCount: number;
}

export interface NoShowScore {
  /** 0 a 1: probabilidade estimada de faltar mesmo tendo confirmado. */
  risk: number;
  reliable: boolean;
  label: "sem histórico" | "comparece" | "atenção" | "falta muito";
}

/**
 * Risco de um paciente confirmar e não aparecer.
 *
 * Serve para priorizar quem recebe lembrete reforçado, nunca para excluir
 * alguém do atendimento — o paciente tem direito à consulta independente do
 * histórico.
 */
export function noShowScore(history: PatientHistory): NoShowScore {
  const { confirmedCount, noShowCount } = history;

  if (confirmedCount < 3) {
    return { risk: 0, reliable: false, label: "sem histórico" };
  }

  const risk = Math.min(1, noShowCount / confirmedCount);
  const label = risk >= 0.5 ? "falta muito" : risk >= 0.25 ? "atenção" : "comparece";

  return { risk, reliable: confirmedCount >= 5, label };
}
