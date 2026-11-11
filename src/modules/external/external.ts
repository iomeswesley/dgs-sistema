/*
  Núcleo puro da API externa (GPT do ChatGPT, 2026-11-11) — só contagem,
  sem banco, testado em external.test.ts. Mesmo padrão de
  indicators.ts/suggestions.ts: o service busca, este arquivo calcula.

  Regra da integração: SÓ NÚMEROS. Nada aqui recebe ou devolve nome,
  telefone, CNS ou procedimento de paciente — só nomes de médico, município
  e unidade (cadastro da DGS, não dado pessoal de paciente).
*/

export type AppointmentStatusKey =
  | "PENDENTE"
  | "ENVIADO"
  | "ENTREGUE"
  | "CONFIRMADO"
  | "RECUSADO"
  | "SEM_RESPOSTA"
  | "SEM_TELEFONE"
  | "SEM_DATA"
  | "FALHA"
  | "CANCELADO";

export interface SituacaoContagem {
  total: number;
  confirmados: number;
  recusados: number;
  /** Ainda pode responder sozinho: pendente de envio, enviado ou entregue. */
  aguardando: number;
  /** Não resolve sozinho: sem telefone, sem data, falha no envio ou prazo estourado sem resposta. */
  precisaDeAcao: number;
  cancelados: number;
  detalhe: {
    pendenteDeEnvio: number;
    enviado: number;
    entregue: number;
    semResposta: number;
    semTelefone: number;
    semData: number;
    falhaNoEnvio: number;
  };
  /** confirmados ÷ (total − cancelados − pendentes de envio), em %, 1 casa. `null` sem base. */
  taxaConfirmacaoPercent: number | null;
}

export function countSituacoes(statuses: readonly string[]): SituacaoContagem {
  const n = (s: AppointmentStatusKey) => statuses.filter((x) => x === s).length;
  const detalhe = {
    pendenteDeEnvio: n("PENDENTE"),
    enviado: n("ENVIADO"),
    entregue: n("ENTREGUE"),
    semResposta: n("SEM_RESPOSTA"),
    semTelefone: n("SEM_TELEFONE"),
    semData: n("SEM_DATA"),
    falhaNoEnvio: n("FALHA"),
  };
  const confirmados = n("CONFIRMADO");
  const recusados = n("RECUSADO");
  const cancelados = n("CANCELADO");
  const base = statuses.length - cancelados - detalhe.pendenteDeEnvio;
  return {
    total: statuses.length,
    confirmados,
    recusados,
    aguardando: detalhe.pendenteDeEnvio + detalhe.enviado + detalhe.entregue,
    precisaDeAcao: detalhe.semResposta + detalhe.semTelefone + detalhe.semData + detalhe.falhaNoEnvio,
    cancelados,
    detalhe,
    taxaConfirmacaoPercent: base > 0 ? Math.round((confirmados / base) * 1000) / 10 : null,
  };
}

export interface AppointmentRow {
  /** YYYY-MM-DD da consulta, em Brasília. */
  dia: string;
  municipio: string;
  medico: string;
  unidade: string | null;
  status: string;
}

export interface AgendaResumo extends SituacaoContagem {
  dia: string;
  municipio: string;
  medico: string;
  unidade: string | null;
}

/** Agrupa agendamentos por dia + município + médico (+ unidade), ordenado por dia e depois município/médico. */
export function groupByAgenda(rows: readonly AppointmentRow[]): AgendaResumo[] {
  const groups = new Map<string, { head: Omit<AgendaResumo, keyof SituacaoContagem>; statuses: string[] }>();
  for (const r of rows) {
    const key = [r.dia, r.municipio, r.medico, r.unidade ?? ""].join("|");
    let g = groups.get(key);
    if (!g) {
      g = { head: { dia: r.dia, municipio: r.municipio, medico: r.medico, unidade: r.unidade }, statuses: [] };
      groups.set(key, g);
    }
    g.statuses.push(r.status);
  }
  return [...groups.values()]
    .map((g) => ({ ...g.head, ...countSituacoes(g.statuses) }))
    .sort(
      (a, b) =>
        a.dia.localeCompare(b.dia) || a.municipio.localeCompare(b.municipio) || a.medico.localeCompare(b.medico)
    );
}

/** Lista as datas YYYY-MM-DD de `from` até `to` (inclusive). Entrada já validada. */
export function daySpan(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000) + 1;
}
