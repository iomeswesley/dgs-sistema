import type { TemplateKind } from "@prisma/client";

// Nomes dos templates como cadastrados no Meta Business Manager, e a ordem
// exata das variáveis de cada um. Ver TEMPLATES-WHATSAPP.md — se o texto
// mudar lá, a ordem aqui precisa acompanhar.
export const TEMPLATE_NAMES: Record<TemplateKind, string> = {
  CONFIRMACAO: "confirmacao_consulta",
  LEMBRETE: "lembrete_vespera",
  VAGA_ABERTA: "convite_vaga_aberta",
};

// Respostas dos botões de resposta rápida. A Meta devolve o título do botão
// no webhook, então o casamento é pelo texto — normalizado sem acento e em
// minúsculas pra comparar de forma tolerante.
const CONFIRM_TITLES = ["sim, vou comparecer", "confirmado, estarei la", "sim, quero a vaga"];
const REFUSE_TITLES = ["nao poderei ir", "nao poderei mais ir", "nao, obrigado"];

// Paciente que responde isso entra em opt-out e nunca mais recebe mensagem.
// Sem uma saída fácil, o único botão que ele conhece é "Bloquear/Denunciar" —
// e é a denúncia que derruba o número.
const OPT_OUT_WORDS = ["sair", "pare", "parar", "descadastrar", "nao quero receber", "remover"];

export type ReplyIntent = "confirm" | "refuse" | "opt_out" | "unknown";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Classifica a resposta do paciente. Clique de botão é sempre inequívoco;
 * texto livre cobre só os casos óbvios e devolve "unknown" no resto, pra
 * equipe resolver na tela (ou a classificação por IA da fase 2).
 */
export function classifyReply(input: { buttonPayload?: string | null; text?: string | null }): ReplyIntent {
  const button = input.buttonPayload ? normalize(input.buttonPayload) : null;
  if (button) {
    if (CONFIRM_TITLES.includes(button)) return "confirm";
    if (REFUSE_TITLES.includes(button)) return "refuse";
  }

  const text = input.text ? normalize(input.text) : null;
  if (!text) return "unknown";

  if (OPT_OUT_WORDS.includes(text)) return "opt_out";

  // Recusa antes de confirmação: "não vou poder" contém "vou", e checar o
  // positivo primeiro classificaria a frase ao contrário.
  if (text.length <= 40 && /\b(nao vou|nao posso|nao poderei|cancelar|desmarcar)\b/.test(text)) {
    return "refuse";
  }

  // Só aceita texto livre curto e sem negação — "sim" confirma, mas
  // "sim, mas nao vou poder" não pode virar confirmação.
  const hasNegation = /\b(nao|n)\b/.test(text);
  if (text.length <= 20 && !hasNegation && /\b(sim|confirmo|confirmado|vou|estarei|ok)\b/.test(text)) {
    return "confirm";
  }

  return "unknown";
}
