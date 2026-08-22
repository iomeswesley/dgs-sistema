// Templates padrão do produto + automação do que falta depois do Embedded
// Signup pra um número novo conseguir enviar de verdade. Texto e variáveis
// aqui têm que ficar em sincronia com TEMPLATES-WHATSAPP.md — aquele arquivo
// é a fonte da verdade documentada; isto aqui é a versão executável.

const GRAPH_API_VERSION = "v21.0";

interface TemplateDefinition {
  name: string;
  category: "UTILITY";
  language: "pt_BR";
  components: unknown[];
}

export const DEFAULT_TEMPLATES: TemplateDefinition[] = [
  {
    name: "confirmacao_consulta",
    category: "UTILITY",
    language: "pt_BR",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "Confirmação de consulta - {{1}}",
        example: { header_text: ["Penha"] },
      },
      {
        type: "BODY",
        text:
          "Olá, {{1}}! Aqui é a DGS, que organiza os atendimentos da Secretaria de Saúde de {{2}}.\n\n" +
          "Você tem uma consulta marcada:\n\nData: {{3}} às {{4}}\nProcedimento: {{5}}\nLocal: {{6}}\n\n" +
          "Podemos confirmar sua presença?",
        example: {
          body_text: [
            [
              "Arthur",
              "Penha",
              "23/07/2026",
              "09:15",
              "Ultrassonografia obstétrica",
              "Policlínica - Av. Eugênio Krause, 2265, Centro",
            ],
          ],
        },
      },
      { type: "FOOTER", text: "DGS - D'Artibale Gestão em Saúde" },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Sim, vou comparecer" },
          { type: "QUICK_REPLY", text: "Não poderei ir" },
        ],
      },
    ],
  },
  {
    name: "lembrete_vespera",
    category: "UTILITY",
    language: "pt_BR",
    components: [
      {
        type: "BODY",
        text:
          "Olá, {{1}}! Lembrando da sua consulta amanhã:\n\nData: {{2}} às {{3}}\nProcedimento: {{4}}\nLocal: {{5}}\n\n" +
          "Leve com você:\n- Documento de identificação com foto\n- Encaminhamento médico\n\n" +
          "Importante: retire a autorização do exame na Unidade Solicitante (UBS, Policlínica ou Hospital) antes da consulta. " +
          "Se já retirou, é só comparecer no horário.\n\nPreparo: {{6}}. Qualquer dúvida, procure a unidade de saúde.",
        example: {
          body_text: [
            [
              "Arthur",
              "23/07/2026",
              "09:15",
              "Ultrassonografia obstétrica",
              "Policlínica - Av. Eugênio Krause, 2265, Centro",
              "Nenhum preparo especial necessário",
            ],
          ],
        },
      },
      { type: "FOOTER", text: "DGS - D'Artibale Gestão em Saúde" },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Confirmado, estarei lá" },
          { type: "QUICK_REPLY", text: "Não poderei mais ir" },
        ],
      },
    ],
  },
  {
    name: "convite_vaga_aberta",
    category: "UTILITY",
    language: "pt_BR",
    components: [
      {
        type: "BODY",
        text:
          "Olá, {{1}}! Aqui é a DGS, que organiza os atendimentos da Secretaria de Saúde de {{2}}.\n\n" +
          "Abriu uma vaga para {{3}}:\n\nData: {{4}} às {{5}}\nLocal: {{6}}\n\nVocê tem interesse nesse horário?",
        example: {
          body_text: [
            ["Arthur", "Penha", "Ultrassonografia obstétrica", "23/07/2026", "09:15", "Policlínica - Av. Eugênio Krause, 2265, Centro"],
          ],
        },
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Sim, quero a vaga" },
          { type: "QUICK_REPLY", text: "Não, obrigado" },
        ],
      },
    ],
  },
  {
    name: "cancelamento_consulta",
    category: "UTILITY",
    language: "pt_BR",
    components: [
      {
        type: "BODY",
        text:
          "*CONSULTA {{1}} CANCELADA*\n\nSua consulta do dia *{{2}}* foi cancelada.\n\n*Motivo:* {{3}}\n\n" +
          "_Em breve informaremos seu novo agendamento._\n\nPedimos desculpas pelo transtorno e agradecemos a " +
          "sua compreensão. 🙏",
        example: { body_text: [["ULTRASSOM", "25/08/2026", "Profissional irá realizar uma cirurgia e ficará ausente por uma semana."]] },
      },
      {
        type: "BUTTONS",
        buttons: [{ type: "QUICK_REPLY", text: "Ciente, obrigado(a)" }],
      },
    ],
  },
];

export interface TemplateStatus {
  name: string;
  status: "APPROVED" | "PENDING" | "REJECTED" | "NAO_ENCONTRADO";
  category?: string;
}

/**
 * Registra o número na Cloud API — passo separado do Embedded Signup,
 * obrigatório antes do primeiro envio (sem isso todo envio falha com
 * "(#133010) Account not registered"). O PIN é gerado na hora e não
 * precisa ser guardado: só seria reusado se algum dia precisássemos
 * rechamar `register` pro mesmo número, o que não é um fluxo hoje.
 * Erro aqui nunca derruba a conexão — só fica registrado no log; a conta
 * continua salva e visível na tela mesmo que esse passo falhe.
 */
export async function registerPhoneNumber(phoneNumberId: string, accessToken: string): Promise<void> {
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(`Falha ao registrar o número na Cloud API: ${JSON.stringify(payload)}`);
  }
}

/**
 * Submete os 3 templates padrão do produto pra uma WABA nova. Tolerante a
 * template já existente (nome duplicado — comum quando a WABA reaproveita
 * um número que já passou por aqui antes): trata como sucesso, não trava a
 * conexão. Cada template é independente — falha em um não impede os outros.
 */
export async function submitDefaultTemplates(wabaId: string, accessToken: string): Promise<void> {
  for (const template of DEFAULT_TEMPLATES) {
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(template),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; error_subcode?: number };
        };
        // 2388024 = "Já existe conteúdo nesse idioma" — a Meta rejeita
        // resubmeter o mesmo nome+idioma de um template já cadastrado.
        // Não é falha de verdade: é exatamente o esperado quando essa
        // função roda de novo numa WABA que já tinha os templates (ex.:
        // reconexão do mesmo número). Confirmado testando manualmente —
        // o texto de `message` sozinho ("Invalid parameter") não diferencia
        // isso de qualquer outro erro, só o `error_subcode` diferencia.
        if (payload.error?.error_subcode !== 2388024) {
          console.error(
            `[WHATSAPP TEMPLATES] Falha ao submeter "${template.name}":`,
            payload.error?.message ?? JSON.stringify(payload)
          );
        }
      }
    } catch (err) {
      console.error(`[WHATSAPP TEMPLATES] Falha ao submeter "${template.name}":`, (err as Error).message);
    }
  }
}

/**
 * Status de aprovação dos 3 templates padrão nessa WABA — consultado ao
 * vivo na Meta (sem cache, é uma tela de configuração, não a fila de envio).
 */
export async function getTemplateStatuses(wabaId: string, accessToken: string): Promise<TemplateStatus[]> {
  const names = DEFAULT_TEMPLATES.map((t) => t.name);
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`);
  url.searchParams.set("fields", "name,status,category");
  url.searchParams.set("limit", "100");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = (await res.json().catch(() => ({}))) as {
    data?: { name: string; status: string; category?: string }[];
  };
  const byName = new Map((payload.data ?? []).map((t) => [t.name, t]));

  return names.map((name) => {
    const found = byName.get(name);
    return {
      name,
      status: (found?.status as TemplateStatus["status"]) ?? "NAO_ENCONTRADO",
      category: found?.category,
    };
  });
}
