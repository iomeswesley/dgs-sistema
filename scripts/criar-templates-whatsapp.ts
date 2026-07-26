/*
  Submete os três templates à aprovação da Meta.

  Precisa de duas variáveis no .env que só existem depois que a conta do
  WhatsApp Business estiver criada:

    WHATSAPP_BUSINESS_ACCOUNT_ID=  (o WABA ID, no Meta Business Manager)
    WHATSAPP_ACCESS_TOKEN=         (token com permissão whatsapp_business_management)

  Uso:  npx tsx --env-file=.env scripts/criar-templates-whatsapp.ts

  O texto vive em TEMPLATES-WHATSAPP.md — se mudar lá, mude aqui junto, e
  confira a ordem das variáveis em src/lib/templates.ts.
*/

const GRAPH_API_VERSION = "v21.0";

interface TemplatePayload {
  name: string;
  language: string;
  category: "UTILITY";
  components: unknown[];
}

const TEMPLATES: TemplatePayload[] = [
  {
    name: "confirmacao_consulta",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "Confirmação de consulta - {{1}}",
        example: { header_text: ["Penha"] },
      },
      {
        type: "BODY",
        text: [
          "Olá, {{1}}! Aqui é a DGS, que organiza os atendimentos da Secretaria de Saúde de {{2}}.",
          "",
          "Você tem uma consulta marcada:",
          "",
          "Data: {{3}} às {{4}}",
          "Procedimento: {{5}}",
          "Local: {{6}}",
          "",
          "Podemos confirmar sua presença?",
        ].join("\n"),
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
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: [
          "Olá, {{1}}! Lembrando da sua consulta amanhã:",
          "",
          "Data: {{2}} às {{3}}",
          "Procedimento: {{4}}",
          "Local: {{5}}",
          "",
          "Leve com você:",
          "- Documento de identificação com foto",
          "- Encaminhamento médico",
          "",
          "Importante: retire a autorização do exame na Unidade Solicitante (UBS, Policlínica ou Hospital) antes da consulta. Se já retirou, é só comparecer no horário.",
          "",
          "Preparo: {{6}}. Qualquer dúvida, procure a unidade de saúde.",
        ].join("\n"),
        example: {
          body_text: [
            [
              "Arthur",
              "23/07/2026",
              "09:15",
              "Ultrassonografia obstétrica",
              "Policlínica - Av. Eugênio Krause, 2265, Centro",
              "Compareça com a bexiga cheia: beba 1 litro de água uma hora antes",
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
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: [
          "Olá, {{1}}! Aqui é a DGS, que organiza os atendimentos da Secretaria de Saúde de {{2}}.",
          "",
          "Abriu uma vaga para {{3}}:",
          "",
          "Data: {{4}} às {{5}}",
          "Local: {{6}}",
          "",
          "Você tem interesse nesse horário?",
        ].join("\n"),
        example: {
          body_text: [
            [
              "Arthur",
              "Penha",
              "Ultrassonografia obstétrica",
              "23/07/2026",
              "09:15",
              "Policlínica - Av. Eugênio Krause, 2265, Centro",
            ],
          ],
        },
      },
      { type: "FOOTER", text: "DGS - D'Artibale Gestão em Saúde" },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Sim, quero a vaga" },
          { type: "QUICK_REPLY", text: "Não, obrigado" },
        ],
      },
    ],
  },
  // Formato atual usado manualmente pela equipe (fora deste sistema) —
  // registrado como template aprovado "de reserva", pra sair do risco de
  // bloqueio (lista de transmissão + reencaminhamento) enquanto o
  // confirmacao_consulta (mais enxuto) ainda está em análise. Ver
  // TEMPLATES-WHATSAPP.md para a comparação e a sugestão de migração.
  {
    name: "confirmacao_consulta_completa",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: [
          "Olá, tudo bem? Me chamo {{1}}, falo em nome da DGS, prestadora de serviços para a Secretaria de Saúde de {{2}}.",
          "",
          "Eu gostaria de confirmar seu agendamento para a consulta em {{3}} para:",
          "",
          "Paciente: {{4}}",
          "Data: {{5}}",
          "Horário: {{6}}",
          "",
          "Endereço: {{7}}",
          "",
          "Importante:",
          "Antes da consulta, o paciente deve retirar a autorização do exame na Unidade Solicitante (Unidade Básica, Policlínica ou Hospital). Caso já esteja ciente e tenha retirado a autorização, basta comparecer na data e horário informados nesta mensagem.",
          "",
          "Lembrando que você precisa levar em mãos:",
          "Documento de Identificação",
          "Encaminhamento Médico",
          "",
          "Responda SIM para confirmar ou NÃO para cancelar.",
        ].join("\n"),
        example: {
          body_text: [
            [
              "Raylane",
              "Penha",
              "Ultrassonografia",
              "Arthur Miguel Cardoso da Silva",
              "23/07/2026",
              "09:15",
              "Policlínica - Av. Eugênio Krause, 2265, Centro, Penha - SC",
            ],
          ],
        },
      },
      { type: "FOOTER", text: "DGS - D'Artibale Gestão em Saúde" },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Sim" },
          { type: "QUICK_REPLY", text: "Não" },
        ],
      },
    ],
  },
];

async function main() {
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!wabaId || !token) {
    console.error(
      "Faltam WHATSAPP_BUSINESS_ACCOUNT_ID e/ou WHATSAPP_ACCESS_TOKEN no .env.\n" +
        "Os dois só existem depois que a conta do WhatsApp Business estiver criada no Meta Business Manager."
    );
    process.exit(1);
  }

  for (const template of TEMPLATES) {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(template),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      error?: { message?: string };
    };

    if (!res.ok) {
      console.error(`✗ ${template.name}: ${payload.error?.message ?? res.status}`);
      continue;
    }
    console.log(`✓ ${template.name} enviado (id ${payload.id}, status ${payload.status ?? "PENDING"})`);
  }

  console.log("\nAcompanhe a aprovação em Meta Business Manager → WhatsApp Manager → Modelos de mensagem.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
