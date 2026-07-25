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
