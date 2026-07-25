export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const digits = e164.replace(/\D/g, "");
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return e164;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** YYYY-MM-DD no fuso local. Nunca use toISOString() para isso. */
export function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDateString(date);
}

export const STATUS_LABEL: Record<string, string> = {
  PENDENTE: "Não enviado",
  ENVIADO: "Enviado",
  ENTREGUE: "Entregue",
  CONFIRMADO: "Confirmou",
  RECUSADO: "Recusou",
  SEM_RESPOSTA: "Sem resposta",
  SEM_TELEFONE: "Sem telefone",
  FALHA: "Falha no envio",
};

export const REFUSAL_LABEL: Record<string, string> = {
  JA_FEZ: "Já fez o procedimento",
  HORARIO_RUIM: "Horário não serve",
  SEM_TRANSPORTE: "Sem transporte",
  MUDOU_SE: "Mudou-se",
  TELEFONE_ERRADO: "Telefone errado",
  OBITO: "Óbito",
  OUTRO: "Outro",
};

export const LIST_STATUS_LABEL: Record<string, string> = {
  EXTRAINDO: "Lendo o arquivo",
  EM_REVISAO: "Aguardando revisão",
  APROVADA: "Aprovada",
  DISPARADA: "Disparada",
  CONCLUIDA: "Concluída",
  ERRO: "Erro na leitura",
};

/** Agrupa os status de agendamento nas quatro faixas de cor. */
export function toBandCounts(counts: Record<string, number>) {
  return {
    confirmados: counts.CONFIRMADO ?? 0,
    recusados: counts.RECUSADO ?? 0,
    aguardando: (counts.PENDENTE ?? 0) + (counts.ENVIADO ?? 0) + (counts.ENTREGUE ?? 0),
    semTelefone:
      (counts.SEM_TELEFONE ?? 0) + (counts.SEM_RESPOSTA ?? 0) + (counts.FALHA ?? 0),
  };
}
