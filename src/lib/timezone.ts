// Fixa o fuso do processo antes de qualquer módulo fazer conta de data.
//
// Sem isso, o servidor roda em UTC (padrão do Vercel) e "hoje" vira o dia
// seguinte a partir das 21h no Brasil — a mesma classe de bug que já causou
// estrago no agendamento-quadra (bloqueio criado com data de amanhã,
// lançamento sumindo da lista do dia). Aqui o risco é pior: uma lista do dia
// seguinte disparando um dia antes do combinado.
process.env.TZ = process.env.TZ || "America/Sao_Paulo";

export const APP_TIMEZONE = process.env.TZ;

/** Data local no formato YYYY-MM-DD. Nunca use toISOString() para isso. */
export function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Interpreta uma string "YYYY-MM-DDTHH:mm[:ss]" (sem timezone — vem da
 * extração de PDF ou de um `<input type="datetime-local">`) como horário de
 * **Brasília**, nunca do fuso do processo Node.
 *
 * Achado em 2026-08-25: `new Date("2026-08-27T07:00")` direto, mesmo com
 * `process.env.TZ = "America/Sao_Paulo"` fixado em `server.ts`/`api/index.js`,
 * foi salvo em produção como `07:00 UTC` (= 04:00 em Brasília) em vez de
 * `10:00 UTC` — o horário do PDF/da correção manual chegava ao paciente 3h
 * adiantado. `process.env.TZ` fixado em runtime nem sempre é respeitado de
 * forma confiável pelo parsing de string "local" do V8 em toda plataforma;
 * anexar o offset explícito na string elimina a ambiguidade de vez, sem
 * depender de configuração de ambiente nenhuma.
 *
 * Se a string já vier com "Z" ou offset explícito, usa como está.
 */
export function parseBrasiliaDateTime(value: string): Date {
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasOffset ? value : `${value}-03:00`);
}

/**
 * "YYYY-MM-DD" do dia local em Brasília de um timestamp de verdade (não
 * uma coluna `@db.Date` — pra essa, ler os componentes UTC direto, nunca
 * passar por `timeZone`, ver `formatCalendarDate` no frontend). `timeZone`
 * explícito no formatador É confiável (diferente de parsing de string sem
 * offset, que foi o bug de 2026-08-25) — não depende de `process.env.TZ`.
 */
export function toBrasiliaDateString(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * 23:59:59.999 de Brasília do mesmo dia local de `date` — usado pra saber
 * se uma resposta chegou "no mesmo dia" da consulta (pedido do usuário em
 * 2026-09-03: resposta chegando depois do fim do dia da consulta não deve
 * mudar o status sozinha, só fica registrada, pra não reescrever o
 * indicador de um período já fechado por causa de uma resposta bem
 * atrasada). Corte simples e genérico de propósito — não é o horário exato
 * da consulta, que seria mais frágil (paciente respondendo minutos depois
 * do próprio horário é normal e deve continuar contando).
 */
export function endOfBrasiliaDay(date: Date): Date {
  return parseBrasiliaDateTime(`${toBrasiliaDateString(date)}T23:59:59.999`);
}
