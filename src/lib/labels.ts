/** Rótulos em português dos enums do banco, compartilhados entre rotas que geram relatório. */

export const STATUS_LABEL: Record<string, string> = {
  PENDENTE: "Não enviado",
  ENVIADO: "Enviado, sem resposta",
  ENTREGUE: "Entregue, sem resposta",
  CONFIRMADO: "Confirmou",
  RECUSADO: "Recusou",
  SEM_RESPOSTA: "Sem resposta",
  SEM_TELEFONE: "Não contatável (sem telefone)",
  FALHA: "Falha na entrega",
  CANCELADO: "Cancelado pela DGS",
};

export const REFUSAL_REASON_LABEL: Record<string, string> = {
  JA_FEZ: "Já fez o procedimento",
  HORARIO_RUIM: "Horário não serve",
  SEM_TRANSPORTE: "Sem transporte",
  MUDOU_SE: "Mudou-se",
  TELEFONE_ERRADO: "Telefone errado",
  OBITO: "Óbito",
  OUTRO: "Outro",
};

/**
 * Texto explicando cada situação de agendamento — mesmo conteúdo da
 * legenda que já existe em `Revisao.tsx` (`STATUS_EXPLANATION`), copiado
 * pra cá pra alimentar também o PDF/CSV exportados (`lists.pdf.ts`,
 * `list-report.ts`). Mantido em sincronia manualmente com o frontend —
 * mesma convenção já usada entre `CancelamentoDetalhe.tsx` e
 * `cancellations.pdf.ts`, poucas linhas, baixo risco de desalinhar.
 */
export const STATUS_EXPLANATION: Record<string, string> = {
  PENDENTE: "Ainda não entrou na fila de envio, ou está esperando a próxima rodada.",
  ENVIADO: "Saiu do nosso número, ainda sem confirmação de entrega.",
  ENTREGUE: "Chegou no celular do paciente. Não significa que ele já respondeu.",
  CONFIRMADO: "O paciente respondeu confirmando presença.",
  RECUSADO: "O paciente respondeu que não vai comparecer.",
  SEM_RESPOSTA: "Chegou, mas o paciente não respondeu dentro do prazo — fechado automaticamente.",
  SEM_TELEFONE: "O cadastro não tem nenhum número válido — nunca chegou a ser tentado.",
  FALHA: "Não chegou — na prática, quase sempre número sem WhatsApp, inválido ou inalcançável.",
  CANCELADO: "A agenda inteira foi cancelada pela equipe (módulo de Cancelamento), não depende de resposta do paciente.",
};

/**
 * Ordem "boas notícias primeiro" pra agrupar relatório por situação (PDF e
 * CSV de Listas) — mesma lógica de prioridade que `toBandCounts()` já usa
 * pra montar a faixa "Confirmados/Recusados/Aguardando/Precisa de ação"
 * (`web/src/lib/format.ts`): confirmados primeiro, depois recusados, depois
 * quem ainda está em trânsito, depois os problemas, cancelado por último
 * (é um caso à parte, não depende de resposta de ninguém).
 */
export const STATUS_ORDER = [
  "CONFIRMADO",
  "RECUSADO",
  "PENDENTE",
  "ENVIADO",
  "ENTREGUE",
  "SEM_TELEFONE",
  "SEM_RESPOSTA",
  "FALHA",
  "CANCELADO",
] as const;

/** Mesmas cores do marca-texto que `StatusPill` usa na tela (modo claro — é o que faz sentido pra impressão/PDF). */
export const STATUS_COLOR: Record<string, { fg: string; bg: string }> = {
  CONFIRMADO: { fg: "#1f9d6b", bg: "#e3f5ed" },
  RECUSADO: { fg: "#d64545", bg: "#fbe7e7" },
  PENDENTE: { fg: "#e0a800", bg: "#fdf3d8" },
  ENVIADO: { fg: "#e0a800", bg: "#fdf3d8" },
  ENTREGUE: { fg: "#e0a800", bg: "#fdf3d8" },
  SEM_TELEFONE: { fg: "#94a3b0", bg: "#eef1f4" },
  SEM_RESPOSTA: { fg: "#94a3b0", bg: "#eef1f4" },
  FALHA: { fg: "#d64545", bg: "#fbe7e7" },
  CANCELADO: { fg: "#94a3b0", bg: "#eef1f4" },
};
