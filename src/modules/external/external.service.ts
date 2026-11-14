import { prisma } from "@/lib/prisma.js";
import { classifyReply } from "@/lib/templates.js";
import { REFUSAL_REASON_LABEL } from "@/lib/labels.js";
import { parseBrasiliaDateTime, startOfBrasiliaDay, toBrasiliaDateString } from "@/lib/timezone.js";
import { getBillingStatus } from "@/modules/billing/billing.service.js";
import { buildIndicators, type GroupBy } from "@/modules/indicators/indicators.service.js";
import { countSituacoes, groupByAgenda } from "./external.js";

/*
  Service da API externa (GPT do ChatGPT do dono da DGS, 2026-11-11).
  Sempre chamado dentro do `runWithClient` aberto por `requireApiToken` —
  o isolamento por cliente vem da extensão do Prisma, igual ao resto.

  SÓ NÚMEROS: nenhuma função daqui devolve nome/telefone/CNS/procedimento
  de paciente (decisão do usuário: "o interessante agora é apenas número").
  Nomes de médico/município/unidade podem sair — é cadastro, não paciente.
*/

const STUCK_ENVIANDO_MINUTES = 15;
const LISTA_PARADA_DIAS = 2;
const OPEN_STATUSES = ["ENVIADO", "ENTREGUE", "FALHA", "SEM_RESPOSTA"] as const;

/** Começo e fim (Brasília) de um intervalo de dias YYYY-MM-DD, inclusive. */
function brasiliaRange(from: string, to: string): { start: Date; end: Date } {
  return {
    start: parseBrasiliaDateTime(`${from}T00:00:00.000`),
    end: parseBrasiliaDateTime(`${to}T23:59:59.999`),
  };
}

/**
 * Atividade do período (o que aconteceu) + pendências de agora (o que
 * precisa de atenção). Versão "só números" do `scripts/status-diario.ts`.
 */
export async function getActivitySummary(from: string, to: string) {
  const { start, end } = brasiliaRange(from, to);
  const now = new Date();
  const todayStart = startOfBrasiliaDay(now);

  const [sent, receivedCount, responded] = await Promise.all([
    prisma.whatsappMessage.findMany({
      where: { direction: "ENVIADA", createdAt: { gte: start, lte: end } },
      select: { template: true, status: true },
    }),
    prisma.whatsappMessage.count({ where: { direction: "RECEBIDA", createdAt: { gte: start, lte: end } } }),
    prisma.appointment.findMany({
      where: { respondedAt: { gte: start, lte: end }, status: { in: ["CONFIRMADO", "RECUSADO"] } },
      select: { status: true, contactedById: true, refusalReason: true },
    }),
  ]);

  const porTipo = { confirmacao: 0, lembrete: 0, vagaAberta: 0, cancelamento: 0, reagendamento: 0, avisoMedico: 0, textoLivre: 0 };
  const TEMPLATE_KEY: Record<string, keyof typeof porTipo> = {
    CONFIRMACAO: "confirmacao",
    LEMBRETE: "lembrete",
    VAGA_ABERTA: "vagaAberta",
    CANCELAMENTO: "cancelamento",
    REAGENDAMENTO: "reagendamento",
    AVISO_MEDICO: "avisoMedico",
  };
  for (const m of sent) porTipo[m.template ? TEMPLATE_KEY[m.template] ?? "textoLivre" : "textoLivre"]++;

  const motivosRecusa: Record<string, number> = {};
  for (const a of responded) {
    if (a.status !== "RECUSADO" || !a.refusalReason) continue;
    const label = REFUSAL_REASON_LABEL[a.refusalReason] ?? a.refusalReason;
    motivosRecusa[label] = (motivosRecusa[label] ?? 0) + 1;
  }

  // Pendências: só de consulta de hoje em diante — "sem telefone" de uma
  // consulta que já passou não tem mais o que fazer.
  const upcoming = { scheduledAt: { gte: todayStart } };
  const [semTelefone, falha, semResposta, semData] = await Promise.all([
    prisma.appointment.count({ where: { ...upcoming, status: "SEM_TELEFONE" } }),
    prisma.appointment.count({ where: { ...upcoming, status: "FALHA" } }),
    prisma.appointment.count({ where: { ...upcoming, status: "SEM_RESPOSTA" } }),
    prisma.appointment.count({ where: { status: "SEM_DATA" } }),
  ]);

  // Respondeu algo que não virou confirmação/recusa sozinho (mesma regra de
  // `GET /api/lists/:id` e do status-diario) — só a contagem.
  const open = await prisma.appointment.findMany({
    where: { ...upcoming, status: { in: [...OPEN_STATUSES] } },
    select: { id: true },
  });
  let respostasParaConferir = 0;
  if (open.length > 0) {
    const inbound = await prisma.whatsappMessage.findMany({
      where: { appointmentId: { in: open.map((a) => a.id) }, direction: "RECEBIDA" },
      orderBy: { createdAt: "desc" },
      select: { appointmentId: true, body: true, buttonPayload: true },
    });
    const seen = new Set<number>();
    for (const m of inbound) {
      if (m.appointmentId === null || seen.has(m.appointmentId)) continue;
      seen.add(m.appointmentId);
      if (classifyReply({ buttonPayload: m.buttonPayload, text: m.body }) !== "opt_out") respostasParaConferir++;
    }
  }

  const stuckCutoff = new Date(now.getTime() - STUCK_ENVIANDO_MINUTES * 60_000);
  const listaCutoff = new Date(now.getTime() - LISTA_PARADA_DIAS * 86_400_000);
  const [travada, prontoPraEnviar, agendadoPraDepois, optOuts, listasEmRevisao, listasParadas, cancelBatches, billing] =
    await Promise.all([
      prisma.messageJob.count({ where: { status: "ENVIANDO", updatedAt: { lt: stuckCutoff } } }),
      prisma.messageJob.count({ where: { status: "PENDENTE", scheduledFor: { lte: now } } }),
      prisma.messageJob.count({ where: { status: "PENDENTE", scheduledFor: { gt: now } } }),
      prisma.patient.count({ where: { optedOutAt: { gte: start, lte: end } } }),
      prisma.list.count({ where: { status: "EM_REVISAO" } }),
      prisma.list.count({ where: { status: "EM_REVISAO", createdAt: { lt: listaCutoff } } }),
      prisma.cancellationBatch.findMany({
        where: { createdAt: { gte: start, lte: end } },
        select: { _count: { select: { appointments: true } } },
      }),
      getBillingStatus(),
    ]);

  return {
    periodo: { de: from, ate: to },
    mensagensEnviadas: {
      total: sent.length,
      porTipo,
      falharam: sent.filter((m) => m.status === "FALHOU").length,
      lidas: sent.filter((m) => m.status === "LIDO").length,
    },
    mensagensRecebidas: receivedCount,
    respostasNoPeriodo: {
      confirmaramPeloWhatsapp: responded.filter((a) => a.status === "CONFIRMADO" && !a.contactedById).length,
      confirmaramPorContatoDaEquipe: responded.filter((a) => a.status === "CONFIRMADO" && a.contactedById).length,
      recusaramPeloWhatsapp: responded.filter((a) => a.status === "RECUSADO" && !a.contactedById).length,
      recusaramPorContatoDaEquipe: responded.filter((a) => a.status === "RECUSADO" && a.contactedById).length,
      motivosRecusa,
    },
    pendenciasAgora: {
      observacao: "Contagem atual, só de consultas de hoje em diante (exceto semData, que não tem data).",
      semTelefone,
      falhaNoEnvio: falha,
      semRespostaPrazoEstourado: semResposta,
      semData,
      respostasParaConferir,
      listasEmRevisao,
      listasEmRevisaoHaMaisDe2Dias: listasParadas,
    },
    filaDeEnvio: {
      prontoPraEnviarAgora: prontoPraEnviar,
      agendadoPraDepois,
      travadaHaMaisDe15Min: travada,
    },
    optOutsNoPeriodo: optOuts,
    cancelamentosNoPeriodo: {
      agendasCanceladas: cancelBatches.length,
      pacientesAvisados: cancelBatches.reduce((sum, b) => sum + b._count.appointments, 0),
    },
    limiteDeMensagens: { bloqueado: billing.blocked },
  };
}

/**
 * Situação dos agendamentos pela DATA DA CONSULTA (não do envio) — responde
 * "como está a agenda de amanhã?". Totais + uma linha por agenda (dia +
 * município + médico + unidade).
 */
export async function getAppointmentsByConsultationDate(from: string, to: string) {
  const { start, end } = brasiliaRange(from, to);
  const appointments = await prisma.appointment.findMany({
    where: { scheduledAt: { gte: start, lte: end } },
    select: {
      scheduledAt: true,
      status: true,
      municipality: { select: { name: true } },
      doctor: { select: { name: true } },
      agenda: { select: { unit: { select: { name: true } } } },
    },
  });
  const rows = appointments.map((a) => ({
    dia: toBrasiliaDateString(a.scheduledAt),
    municipio: a.municipality.name,
    medico: a.doctor.name,
    unidade: a.agenda?.unit?.name ?? null,
    status: a.status,
  }));
  return {
    periodo: { de: from, ate: to },
    totais: countSituacoes(rows.map((r) => r.status)),
    agendas: groupByAgenda(rows),
  };
}

export type Agrupamento = "medico" | "municipio" | "procedimento" | "mes";

const GROUP_BY: Record<Agrupamento, GroupBy> = {
  medico: "doctor",
  municipio: "municipality",
  procedimento: "procedure",
  mes: "month",
};

function pct(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000) / 10;
}

/**
 * Mesmos números da tela Indicadores (mesma função, mesmos filtros), sem os
 * campos financeiros (fora de escopo desde 2026-08-09) e com as taxas em %.
 */
export async function getIndicatorsSummary(from: Date, to: Date, agrupar: Agrupamento) {
  const report = await buildIndicators({ from, to }, GROUP_BY[agrupar]);
  const shape = (t: (typeof report)["totals"]) => ({
    planejados: t.planned,
    contataveis: t.contactable,
    confirmados: t.confirmed,
    recusados: t.refused,
    semResposta: t.noAnswer,
    inalcancaveis: t.unreachable,
    atendidos: t.attended,
    encaixes: t.extras,
    tentativasDeConfirmacao: t.confirmationBase,
    confirmadosNoFluxoDeConfirmacao: t.confirmationConfirmed,
    taxaConfirmacaoPercent: pct(t.confirmationRate),
    taxaComparecimentoPercent: pct(t.attendanceRate),
    taxaAproveitamentoPercent: pct(t.utilizationRate),
  });
  return {
    totais: shape(report.totals),
    agrupadoPor: agrupar,
    grupos: report.breakdown.map((b) => ({ nome: b.label, ...shape(b) })),
  };
}

const LIST_STATUS_LABEL: Record<string, string> = {
  EXTRAINDO: "lendo o arquivo",
  EM_REVISAO: "em revisão",
  APROVADA: "aprovada",
  DISPARADA: "disparada",
  CONCLUIDA: "concluída",
  ERRO: "erro na leitura",
};

/** Listas enviadas no período (data de upload), com a situação dos pacientes de cada uma. */
export async function getListsSummary(from: string, to: string) {
  const { start, end } = brasiliaRange(from, to);
  const lists = await prisma.list.findMany({
    where: { createdAt: { gte: start, lte: end } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      isComplementary: true,
      createdAt: true,
      dispatchedAt: true,
      municipality: { select: { name: true } },
      agenda: { select: { date: true, doctor: { select: { name: true } }, unit: { select: { name: true } } } },
      appointments: { select: { status: true } },
    },
  });
  return {
    periodo: { de: from, ate: to },
    quantidade: lists.length,
    listas: lists.map((l) => ({
      id: l.id,
      municipio: l.municipality.name,
      medico: l.agenda?.doctor.name ?? null,
      unidade: l.agenda?.unit?.name ?? null,
      // `Agenda.date` é @db.Date: lê os componentes UTC, nunca converte fuso.
      dataDaAgenda: l.agenda ? l.agenda.date.toISOString().slice(0, 10) : null,
      situacaoDaLista: LIST_STATUS_LABEL[l.status] ?? l.status,
      reposicaoDeVaga: l.isComplementary,
      enviadaEm: toBrasiliaDateString(l.createdAt),
      disparadaEm: l.dispatchedAt ? toBrasiliaDateString(l.dispatchedAt) : null,
      pacientes: countSituacoes(l.appointments.map((a) => a.status)),
    })),
  };
}
