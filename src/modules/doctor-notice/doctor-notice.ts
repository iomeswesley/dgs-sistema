import { toBrasiliaDateString } from "@/lib/timezone.js";

/*
  Partes puras do aviso de agenda ao médico (sem banco/env), testadas em
  doctor-notice.test.ts. O service (doctor-notice.service.ts) usa estas.
*/

/** Janela da manhã (hora de Brasília) em que o aviso automático sai — o cron roda a cada 10 min o dia todo. */
export const MORNING_START_HOUR = 7;
export const MORNING_END_HOUR = 12;

export function brasiliaHour(date: Date): number {
  return Number(date.toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" }));
}

export function isMorningWindow(now: Date): boolean {
  const hour = brasiliaHour(now);
  return hour >= MORNING_START_HOUR && hour < MORNING_END_HOUR;
}

/** Valor de coluna `@db.Date` de amanhã: meia-noite UTC do dia seguinte ao de hoje EM BRASÍLIA. */
export function tomorrowCalendarDate(now: Date): Date {
  const [year, month, day] = toBrasiliaDateString(now).split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1));
}

/** "segunda-feira, 16/11/2026" — `Agenda.date` é `@db.Date`, então lê em UTC (nunca passa por fuso). */
export function formatAgendaDate(date: Date): string {
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
  const day = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  return `${weekday}, ${day}`;
}

/** "Dr. Luiz Felipe" — o tratamento vem do cadastro (Dr./Dra.); sem ele, só o nome. */
export function doctorGreetingName(doctor: { name: string; title: string | null }): string {
  const name = doctor.name.trim();
  const title = doctor.title?.trim();
  return title ? `${title} ${name}` : name;
}

/** Procedimentos da agenda quando ela não tem um definido: até 3 por extenso, senão resume. */
export function summarizeProcedures(names: string[]): string {
  const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n && n !== "Não informado"))];
  if (unique.length === 0) return "conforme a agenda";
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 2).join(", ")} e mais ${unique.length - 2}`;
}
