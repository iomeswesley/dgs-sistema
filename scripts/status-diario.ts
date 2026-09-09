/*
  Report diário de atividade — pedido do usuário em 2026-09-09: uma forma
  padronizada de perguntar "como está o status hoje?" e receber um resumo
  do que aconteceu (confirmações, recusas, contato manual) e o que precisa
  de atenção (resposta não classificada, fila travada, lista parada em
  revisão, etc.), sem precisar reconstruir cada consulta na mão toda vez.

  Não manda nada pra ninguém — só lê o banco e devolve um JSON estruturado
  (Claude narra em cima disso, ver convenção em CLAUDE.md).

    npx tsx --env-file=.env scripts/status-diario.ts                # hoje
    npx tsx --env-file=.env scripts/status-diario.ts 2026-09-08      # um dia específico
    npx tsx --env-file=.env scripts/status-diario.ts 2026-09-01 7    # 7 dias terminando nessa data
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { classifyReply } from "../src/lib/templates.js";
import { parseBrasiliaDateTime, toBrasiliaDateString, endOfBrasiliaDay } from "../src/lib/timezone.js";

const OPEN_STATUSES = ["ENVIADO", "ENTREGUE", "FALHA", "SEM_RESPOSTA"] as const;
const STUCK_ENVIANDO_MINUTES = 15;
const LISTA_PARADA_DIAS = 2;

function startOfBrasiliaDay(date: Date): Date {
  return parseBrasiliaDateTime(`${toBrasiliaDateString(date)}T00:00:00.000`);
}

async function main() {
  const [dateArg, daysArg] = process.argv.slice(2);
  const anchor = dateArg ? parseBrasiliaDateTime(`${dateArg}T12:00:00`) : new Date();
  const days = daysArg ? Math.max(1, parseInt(daysArg, 10)) : 1;

  const end = endOfBrasiliaDay(anchor);
  const startAnchor = new Date(anchor);
  startAnchor.setDate(startAnchor.getDate() - (days - 1));
  const start = startOfBrasiliaDay(startAnchor);

  await runWithClient(1, async () => {
    const now = new Date();

    // 1) Mensagens ENVIADAS no período, por template e desfecho.
    const sentMessages = await prisma.whatsappMessage.findMany({
      where: { direction: "ENVIADA", createdAt: { gte: start, lte: end } },
      select: { template: true, status: true },
    });
    const porTemplate: Record<string, { enviado: number; entregue: number; lido: number; falhou: number }> = {};
    for (const m of sentMessages) {
      const key = m.template ?? "SEM_TEMPLATE";
      porTemplate[key] ??= { enviado: 0, entregue: 0, lido: 0, falhou: 0 };
      if (m.status === "ENVIADO") porTemplate[key].enviado++;
      else if (m.status === "ENTREGUE") porTemplate[key].entregue++;
      else if (m.status === "LIDO") porTemplate[key].lido++;
      else if (m.status === "FALHOU") porTemplate[key].falhou++;
    }

    // 2) Confirmações/recusas respondidas no período — separa clique/texto
    // (via WhatsApp) de contato manual da equipe (mesmo critério de
    // `indicators.service.ts`: contactedById preenchido = manual).
    const responded = await prisma.appointment.findMany({
      where: { respondedAt: { gte: start, lte: end }, status: { in: ["CONFIRMADO", "RECUSADO"] } },
      select: { status: true, contactedById: true, refusalReason: true },
    });
    const confirmacoes = {
      confirmadosWhatsapp: responded.filter((a) => a.status === "CONFIRMADO" && !a.contactedById).length,
      confirmadosManual: responded.filter((a) => a.status === "CONFIRMADO" && a.contactedById).length,
      recusadosWhatsapp: responded.filter((a) => a.status === "RECUSADO" && !a.contactedById).length,
      recusadosManual: responded.filter((a) => a.status === "RECUSADO" && a.contactedById).length,
      motivosRecusa: responded
        .filter((a) => a.status === "RECUSADO" && a.refusalReason)
        .reduce<Record<string, number>>((acc, a) => {
          const key = a.refusalReason as string;
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
    };

    // 3) Precisa de ação — situações atuais (não só do período), porque
    // "sem telefone"/"falha" de ontem continua precisando de ação hoje.
    const [semTelefone, falha, semResposta] = await Promise.all([
      prisma.appointment.count({ where: { status: "SEM_TELEFONE" } }),
      prisma.appointment.count({ where: { status: "FALHA" } }),
      prisma.appointment.count({ where: { status: "SEM_RESPOSTA" } }),
    ]);

    // Resposta que chegou mas não aplicou sozinha — mesma lógica de
    // `GET /api/lists/:id`, aqui em escala do sistema inteiro.
    const openAppointments = await prisma.appointment.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      select: { id: true, scheduledAt: true, patient: { select: { name: true } } },
    });
    const openIds = openAppointments.map((a) => a.id);
    const inbound =
      openIds.length > 0
        ? await prisma.whatsappMessage.findMany({
            where: { appointmentId: { in: openIds }, direction: "RECEBIDA" },
            orderBy: { createdAt: "desc" },
            select: { appointmentId: true, body: true, buttonPayload: true, createdAt: true },
          })
        : [];
    const unclassifiedByAppointment = new Map<number, { preview: string; createdAt: Date }>();
    for (const m of inbound) {
      if (m.appointmentId === null) continue;
      if (unclassifiedByAppointment.has(m.appointmentId)) continue; // já pegou a mais recente
      const intent = classifyReply({ buttonPayload: m.buttonPayload, text: m.body });
      if (intent === "opt_out") continue;
      unclassifiedByAppointment.set(m.appointmentId, {
        preview: m.buttonPayload ?? m.body ?? "",
        createdAt: m.createdAt,
      });
    }
    const nameById = new Map(openAppointments.map((a) => [a.id, a.patient.name]));
    const respostasNaoClassificadas = [...unclassifiedByAppointment.entries()].map(([appointmentId, info]) => ({
      appointmentId,
      paciente: nameById.get(appointmentId) ?? "?",
      preview: info.preview.slice(0, 120),
      chegouHoje: info.createdAt >= start && info.createdAt <= end,
    }));

    // 4) Fila travada — MessageJob preso em ENVIANDO há mais tempo do que
    // um envio deveria levar (ver bug real de 2026-09-07/08: 443 mensagens
    // ficaram presas em ENVIANDO pra sempre até serem destravadas na mão).
    const stuckCutoff = new Date(now.getTime() - STUCK_ENVIANDO_MINUTES * 60_000);
    const stuckJobs = await prisma.messageJob.count({ where: { status: "ENVIANDO", updatedAt: { lt: stuckCutoff } } });

    // 5) Fila pendente agora (backlog geral, não só travado).
    const [pendenteAgora, pendenteFuturo] = await Promise.all([
      prisma.messageJob.count({ where: { status: "PENDENTE", scheduledFor: { lte: now } } }),
      prisma.messageJob.count({ where: { status: "PENDENTE", scheduledFor: { gt: now } } }),
    ]);

    // 6) Opt-out no período.
    const optOuts = await prisma.patient.findMany({
      where: { optedOutAt: { gte: start, lte: end } },
      select: { name: true, optedOutAt: true },
    });

    // 7) Lista em revisão parada há mais de X dias sem ninguém aprovar/agir.
    const cutoffLista = new Date(now.getTime() - LISTA_PARADA_DIAS * 24 * 60 * 60_000);
    const listasParadas = await prisma.list.findMany({
      where: { status: "EM_REVISAO", createdAt: { lt: cutoffLista } },
      select: { id: true, originalName: true, createdAt: true, municipality: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });

    // 8) Cancelamentos disparados no período.
    const cancelBatches = await prisma.cancellationBatch.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { id: true, reason: true, _count: { select: { appointments: true } } },
    });

    const report = {
      periodo: { de: toBrasiliaDateString(start), ate: toBrasiliaDateString(end) },
      mensagensEnviadas: { total: sentMessages.length, porTemplate },
      confirmacoes,
      precisaDeAcao: {
        semTelefone,
        falha,
        semResposta,
        respostasNaoClassificadas: respostasNaoClassificadas.sort((a, b) => (a.chegouHoje === b.chegouHoje ? 0 : a.chegouHoje ? -1 : 1)),
      },
      filaTravada: { presoEmEnviandoHaMaisDe15Min: stuckJobs },
      filaPendente: { prontoPraEnviarAgora: pendenteAgora, agendadoPraDepois: pendenteFuturo },
      optOuts: optOuts.map((p) => ({ nome: p.name, quando: p.optedOutAt })),
      listasPendentesEmRevisao: listasParadas.map((l) => ({
        id: l.id,
        arquivo: l.originalName,
        municipio: l.municipality.name,
        criadaEm: l.createdAt,
        diasParada: Math.floor((now.getTime() - l.createdAt.getTime()) / (24 * 60 * 60_000)),
      })),
      cancelamentosDisparados: cancelBatches.map((b) => ({
        id: b.id,
        motivo: b.reason,
        pacientesNotificados: b._count.appointments,
      })),
    };

    console.log(JSON.stringify(report, null, 2));
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
