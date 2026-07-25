import { prisma } from "@/lib/prisma.js";
import { emailConfigured, sendEmail } from "@/lib/email.js";
import { queueCapacity } from "@/modules/queue/queue.service.js";

/*
  Resumo do dia pro gestor.

  Roda no fim da tarde (cron separado, ver vercel.json) e manda um e-mail
  pra equipe toda com a foto de como está a agenda de amanhã: "68%
  confirmado, 12 sem resposta — vale reforçar?". O objetivo é permitir agir
  ainda hoje, não descobrir amanhã de manhã que a taxa está baixa.
*/

function startOfTomorrow(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

interface GroupSummary {
  label: string;
  total: number;
  confirmed: number;
  refused: number;
  pending: number;
  unreachable: number;
}

function percent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export interface DailySummaryData {
  tomorrow: string;
  overall: GroupSummary;
  byDoctor: GroupSummary[];
  capacity: Awaited<ReturnType<typeof queueCapacity>>;
  hasContent: boolean;
}

export async function buildDailySummary(): Promise<DailySummaryData> {
  const tomorrow = startOfTomorrow();
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const appointments = await prisma.appointment.findMany({
    where: { scheduledAt: { gte: tomorrow, lt: dayAfter } },
    select: { status: true, doctor: { select: { name: true } } },
  });

  const overall: GroupSummary = { label: "Total", total: 0, confirmed: 0, refused: 0, pending: 0, unreachable: 0 };
  const byDoctorMap = new Map<string, GroupSummary>();

  for (const appointment of appointments) {
    const group =
      byDoctorMap.get(appointment.doctor.name) ??
      { label: appointment.doctor.name, total: 0, confirmed: 0, refused: 0, pending: 0, unreachable: 0 };

    for (const target of [overall, group]) {
      target.total++;
      if (appointment.status === "CONFIRMADO") target.confirmed++;
      else if (appointment.status === "RECUSADO") target.refused++;
      else if (appointment.status === "SEM_TELEFONE") target.unreachable++;
      else target.pending++; // pendente/enviado/entregue/sem_resposta/falha: ainda em aberto
    }
    byDoctorMap.set(appointment.doctor.name, group);
  }

  return {
    tomorrow: tomorrow.toLocaleDateString("pt-BR"),
    overall,
    byDoctor: Array.from(byDoctorMap.values()).sort((a, b) => b.total - a.total),
    capacity: await queueCapacity(),
    hasContent: appointments.length > 0,
  };
}

function rowHtml(group: GroupSummary): string {
  return `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;">${group.label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;">${group.total}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;color:#1f9d6b;">${group.confirmed}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;color:#d64545;">${group.refused}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;color:#e0a800;">${group.pending}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;">${percent(group.confirmed, group.total - group.unreachable)}</td>
    </tr>`;
}

function buildHtml(data: DailySummaryData): string {
  const rows = [data.overall, ...data.byDoctor].map(rowHtml).join("");
  return `
    <p>Agenda de amanhã (${data.tomorrow}):</p>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
      <thead>
        <tr>
          <th style="padding:6px 10px;text-align:left;">Médico</th>
          <th style="padding:6px 10px;text-align:right;">Total</th>
          <th style="padding:6px 10px;text-align:right;">Confirmou</th>
          <th style="padding:6px 10px;text-align:right;">Recusou</th>
          <th style="padding:6px 10px;text-align:right;">Sem resposta</th>
          <th style="padding:6px 10px;text-align:right;">% confirmação</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:16px;font-family:sans-serif;font-size:14px;">
      Fila de envio: ${data.capacity.used} de ${data.capacity.dailyLimit} usadas hoje,
      ${data.capacity.pending} pendentes.
    </p>
    ${
      data.overall.pending > 0
        ? `<p style="font-family:sans-serif;font-size:14px;"><b>${data.overall.pending} pacientes ainda sem resposta</b> — vale reforçar contato antes do fim do dia.</p>`
        : ""
    }
  `;
}

export interface SendResult {
  sent: number;
  skipped: string;
}

/** Manda o resumo pra todo mundo com acesso ativo. Sem gente pra receber, não envia nada. */
export async function sendDailySummary(): Promise<SendResult> {
  const data = await buildDailySummary();
  if (!data.hasContent) return { sent: 0, skipped: "sem agendamentos para amanhã" };
  if (!emailConfigured) return { sent: 0, skipped: "RESEND_API_KEY não configurada" };

  const users = await prisma.user.findMany({ where: { active: true }, select: { email: true } });
  const html = buildHtml(data);

  let sent = 0;
  for (const user of users) {
    try {
      await sendEmail({
        to: user.email,
        subject: `Resumo de amanhã (${data.tomorrow}) — ${percent(data.overall.confirmed, data.overall.total - data.overall.unreachable)} confirmado`,
        html,
      });
      sent++;
    } catch (err) {
      console.error(`[RESUMO] Falha ao enviar para ${user.email}:`, (err as Error).message);
    }
  }

  return { sent, skipped: "" };
}
