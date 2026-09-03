/*
  Núcleo puro do cálculo de indicadores — recebe os dados já buscados do
  banco (agendamentos, fechamentos, valores por médico×procedimento) e
  devolve os totais e o detalhamento agrupado. Sem `prisma` aqui, só lógica
  — o mesmo padrão de `modules/suggestions/suggestions.ts` e
  `modules/closings/closings.alerts.ts`: fácil de testar sem banco, e
  `indicators.service.ts` fica só responsável por buscar e mapear.

  Fórmulas fixadas no PLANO.md:

    % Confirmação    = confirmados ÷ contatáveis   (eficácia do disparo)
    % Comparecimento = atendidos ÷ confirmados     (no-show de quem disse sim)
    % Aproveitamento = atendidos ÷ planejados      (visão da secretaria)
    Divergência      = pagos ÷ atendidos           (médico × guias)

  "Contatáveis" exclui quem não tem telefone: cobrar do disparo um paciente
  que nunca poderia receber mensagem distorceria a leitura, e a lista de não
  contatáveis já volta pra secretaria por outro caminho.
*/

export interface AppointmentInput {
  doctorId: number;
  municipalityId: number;
  procedureId: number | null;
  scheduledAt: Date;
  status: string;
  doctorName: string;
  municipalityName: string;
  procedureName: string | null;
  // Os 3 campos abaixo só alimentam a "% Confirmação" corrigida em
  // 2026-09-03 (ver comentário em `finalize`) — não entram em mais
  // nenhuma outra taxa.
  /** Veio de uma lista de reposição de vaga (template VAGA_ABERTA, não CONFIRMACAO) — fluxo diferente, fora do escopo dessa taxa. */
  isComplementary: boolean;
  /** Teve pelo menos 1 WhatsappMessage ENVIADA com template CONFIRMACAO. */
  confirmationTemplateSent: boolean;
  /** Equipe registrou contato manual (ligou), independente de mensagem ter saído. */
  manuallyContacted: boolean;
}

export interface ClosingInput {
  doctorId: number;
  municipalityId: number;
  procedureId: number | null;
  date: Date;
  doctorName: string;
  municipalityName: string;
  procedureName: string | null;
  attendedReported: number | null;
  paidCount: number | null;
  extrasCount: number;
}

export interface FeeInput {
  doctorId: number;
  procedureId: number;
  doctorFee: number | null;
  cityRate: number | null;
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
  // Achado pelo usuário em 2026-09-03: a "% Confirmação" antiga (confirmed
  // ÷ contactable) misturava agendamento nunca disparado ainda (PENDENTE,
  // ninguém tentou nada) e reposição de vaga (VAGA_ABERTA, fluxo
  // diferente) no mesmo denominador de "confirmação de consulta" —
  // distorcia a taxa pra baixo sem representar confirmação perdida de
  // verdade. Substituído por um par dedicado: `confirmationBase` conta só
  // quem teve uma tentativa REAL de confirmar (template CONFIRMACAO
  // enviado OU contato manual da equipe), excluindo sempre reposição de
  // vaga; `confirmationConfirmed` é quantos desses viraram CONFIRMADO —
  // não importa se veio do clique "Sim" ou do contato manual, os dois
  // contam igual (pedido explícito do usuário).
  confirmationBase: number;
  confirmationConfirmed: number;
  /** null quando não há base para calcular — nunca 0 disfarçado. */
  confirmationRate: number | null;
  attendanceRate: number | null;
  utilizationRate: number | null;
  divergenceRate: number | null;
  // Financeiro em desenvolvimento (decisão de escopo de 2026-08-09) — os
  // três campos abaixo continuam calculados (fica pronto pra quando a
  // feature voltar), mas a UI não exibe nenhum deles por enquanto.
  doctorPayout: number | null;
  cityBilling: number | null;
  margin: number | null;
}

export interface IndicatorBreakdown extends IndicatorTotals {
  key: string;
  label: string;
}

export type GroupBy = "doctor" | "municipality" | "procedure" | "month";

// As 4 chaves de TemplateKind (schema.prisma) — repetido aqui como union
// literal (não importado do Prisma) pra este arquivo continuar puro, sem
// dependência de `@prisma/client` (mesma escolha de `AppointmentInput.status`
// ser `string`, não o enum).
export type TemplateKindKey = "CONFIRMACAO" | "LEMBRETE" | "VAGA_ABERTA" | "CANCELAMENTO";

export interface DailyMessageCount {
  date: string; // YYYY-MM-DD, Brasília
  count: number;
  byTemplate: Record<TemplateKindKey, number>;
}

function emptyTemplateCounts(): Record<TemplateKindKey, number> {
  return { CONFIRMACAO: 0, LEMBRETE: 0, VAGA_ABERTA: 0, CANCELAMENTO: 0 };
}

/**
 * Agrupa mensagens ENVIADAS por dia (Brasília) e por template, preenchendo
 * com 0 os dias sem envio dentro do intervalo — sem isso o gráfico de
 * colunas teria buracos silenciosos em vez de barras zeradas, difícil de
 * distinguir de "não carregou ainda". `dayKey` já vem calculado pelo
 * chamador (mesma separação timestamp-de-verdade vs `@db.Date` do resto do
 * arquivo). `template: null` (mensagem avulsa, fora dos 4 modelos padrão —
 * hoje só acontece por `sendReply`/texto livre em Conversas) soma no total
 * do dia mas não em nenhuma barra do empilhado, pra não inventar uma 5ª
 * categoria rara que ninguém pediria pra distinguir visualmente.
 */
export function buildMessagesPerDaySeries(
  sent: { dayKey: string; template: TemplateKindKey | null }[],
  fromDayKey: string,
  toDayKey: string
): DailyMessageCount[] {
  const counts = new Map<string, { count: number; byTemplate: Record<TemplateKindKey, number> }>();
  for (const { dayKey, template } of sent) {
    let entry = counts.get(dayKey);
    if (!entry) {
      entry = { count: 0, byTemplate: emptyTemplateCounts() };
      counts.set(dayKey, entry);
    }
    entry.count++;
    if (template) entry.byTemplate[template]++;
  }

  const series: DailyMessageCount[] = [];
  const cursor = new Date(`${fromDayKey}T00:00:00Z`);
  const end = new Date(`${toDayKey}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    const entry = counts.get(key);
    series.push({ date: key, count: entry?.count ?? 0, byTemplate: entry?.byTemplate ?? emptyTemplateCounts() });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

export interface StatusCounts {
  PENDENTE: number;
  ENVIADO: number;
  ENTREGUE: number;
  CONFIRMADO: number;
  RECUSADO: number;
  SEM_RESPOSTA: number;
  SEM_TELEFONE: number;
  FALHA: number;
}

function emptyStatusCounts(): StatusCounts {
  return { PENDENTE: 0, ENVIADO: 0, ENTREGUE: 0, CONFIRMADO: 0, RECUSADO: 0, SEM_RESPOSTA: 0, SEM_TELEFONE: 0, FALHA: 0 };
}

export interface ReceivedFlowBreakdown {
  confirmacao: StatusCounts;
  vagaAberta: StatusCounts;
}

/**
 * Desfecho de quem recebeu mensagem, separado por fluxo (confirmação de
 * consulta vs. reposição de vaga) — pedido do usuário em 2026-09-03: um
 * gráfico por template, mostrando quem confirmou/recusou/não respondeu.
 * Cancelamento fica de fora daqui (schema de status diferente, "Ciente" não
 * é `AppointmentStatus` nenhum) — ver `getCancellationReceivedBreakdown`
 * em cancellations.service.ts.
 */
export function buildReceivedFlowBreakdown(
  appointments: { status: string; isComplementary: boolean }[]
): ReceivedFlowBreakdown {
  const confirmacao = emptyStatusCounts();
  const vagaAberta = emptyStatusCounts();
  for (const appointment of appointments) {
    const bucket = appointment.isComplementary ? vagaAberta : confirmacao;
    if (appointment.status in bucket) {
      bucket[appointment.status as keyof StatusCounts]++;
    }
  }
  return { confirmacao, vagaAberta };
}

export interface IndicatorReport {
  totals: IndicatorTotals;
  breakdown: IndicatorBreakdown[];
}

// Mesma classe de bug achada em 2026-08-26 (closings.service.ts): agrupar por
// mês com getters locais depende do fuso do processo, que já provou não ser
// confiável. `scheduledAt` é timestamp de verdade (mês local em Brasília,
// via timeZone explícito); `closing.date` é `@db.Date` (já é meia-noite UTC
// do dia certo — lê os componentes UTC direto, nunca timeZone).
function monthKeyFromTimestamp(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
}

function monthKeyFromCalendarDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
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
    confirmationBase: 0,
    confirmationConfirmed: 0,
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
    confirmationRate: rate(totals.confirmationConfirmed, totals.confirmationBase),
    attendanceRate: totals.attended === null ? null : rate(totals.attended, totals.confirmed),
    utilizationRate: totals.attended === null ? null : rate(totals.attended, totals.planned),
    divergenceRate:
      totals.paid === null || totals.attended === null ? null : rate(totals.paid, totals.attended),
  };
}

export function buildIndicatorsCore(
  appointments: AppointmentInput[],
  closings: ClosingInput[],
  fees: FeeInput[],
  groupBy: GroupBy
): IndicatorReport {
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
    /** "YYYY-MM" já resolvido pelo chamador — ver nota abaixo sobre por quê. */
    monthKey: string;
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
      key = item.monthKey;
      label = item.monthKey;
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
      monthKey: monthKeyFromTimestamp(appointment.scheduledAt),
      doctorName: appointment.doctorName,
      municipalityName: appointment.municipalityName,
      procedureName: appointment.procedureName,
    });

    for (const target of [totals, group]) {
      target.planned++;
      if (appointment.status === "SEM_TELEFONE") target.unreachable++;
      else target.contactable++;

      if (appointment.status === "CONFIRMADO") target.confirmed++;
      else if (appointment.status === "RECUSADO") target.refused++;
      else if (appointment.status === "SEM_RESPOSTA" || appointment.status === "FALHA") target.noAnswer++;

      if (!appointment.isComplementary && (appointment.confirmationTemplateSent || appointment.manuallyContacted)) {
        target.confirmationBase++;
        if (appointment.status === "CONFIRMADO") target.confirmationConfirmed++;
      }
    }
  }

  for (const closing of closings) {
    const group = bucketFor({
      doctorId: closing.doctorId,
      municipalityId: closing.municipalityId,
      procedureId: closing.procedureId,
      monthKey: monthKeyFromCalendarDate(closing.date),
      doctorName: closing.doctorName,
      municipalityName: closing.municipalityName,
      procedureName: closing.procedureName,
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
