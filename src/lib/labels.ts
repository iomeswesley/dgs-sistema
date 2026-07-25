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
