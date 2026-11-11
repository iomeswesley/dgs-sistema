/*
  Especificação OpenAPI da API externa — o ChatGPT importa isto na "Action"
  do GPT (Configurar → Ações → Importar de URL:
  https://regulacao.vercel.app/api/externo/openapi.json). As descrições
  são o que o GPT lê pra decidir qual endpoint chamar, por isso são em
  português e dizem quando usar cada um. A OpenAI limita a descrição
  de cada operação a 300 caracteres.
*/

const dateParam = (name: string, description: string) => ({
  name,
  in: "query",
  required: false,
  description,
  schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", example: "2026-11-11" },
});

const objectResponse = (description: string) => ({
  200: { description, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
  401: { description: "Token ausente, inválido ou revogado." },
  400: { description: "Parâmetro inválido (data fora do formato AAAA-MM-DD ou intervalo grande demais)." },
});

export function buildOpenApiSpec(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "RegulAção — números do sistema",
      version: "1.0.0",
      description:
        "Consulta só de leitura dos números do sistema de confirmação de consultas por WhatsApp (DGS). " +
        "Só números agregados: nunca traz nome, telefone ou dado de paciente. Datas em AAAA-MM-DD, fuso de Brasília.",
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: {},
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/externo/resumo": {
        get: {
          operationId: "resumoDoDia",
          summary: "Resumo de atividade e pendências",
          description:
            "Use para 'como está hoje?'. Mensagens enviadas/recebidas no período, quem confirmou ou recusou (WhatsApp ou equipe), " +
            "motivos de recusa e pendências atuais (sem telefone, falha, respostas para conferir, fila). Padrão: hoje.",
          parameters: [
            dateParam("de", "Primeiro dia do período (padrão: hoje)."),
            dateParam("ate", "Último dia do período (padrão: hoje). Máximo 62 dias."),
          ],
          responses: objectResponse("Resumo do período."),
        },
      },
      "/api/externo/agendamentos": {
        get: {
          operationId: "agendamentosPorDataDaConsulta",
          summary: "Situação das consultas por data da consulta",
          description:
            "Use para 'como está a agenda de amanhã/da semana?'. Pela DATA DA CONSULTA: total, confirmados, recusados, aguardando " +
            "e precisa de ação, por agenda (dia, município, médico, unidade). Padrão: hoje e amanhã.",
          parameters: [
            dateParam("de", "Primeiro dia de consulta (padrão: hoje)."),
            dateParam("ate", "Último dia de consulta (padrão: amanhã). Máximo 62 dias."),
          ],
          responses: objectResponse("Totais e uma linha por agenda."),
        },
      },
      "/api/externo/listas": {
        get: {
          operationId: "listasEnviadas",
          summary: "Listas de agendamento enviadas ao sistema",
          description:
            "Use para saber quais listas (PDF/Excel da prefeitura) entraram, se já foram aprovadas/disparadas e como estão os " +
            "pacientes de cada uma. Filtra pela data de envio da lista. Padrão: últimos 7 dias. Máximo 100 listas.",
          parameters: [
            dateParam("de", "Primeiro dia de envio (padrão: 6 dias atrás)."),
            dateParam("ate", "Último dia de envio (padrão: hoje). Máximo 62 dias."),
          ],
          responses: objectResponse("Listas do período."),
        },
      },
      "/api/externo/indicadores": {
        get: {
          operationId: "indicadores",
          summary: "Indicadores do período (mesmos da tela Indicadores)",
          description:
            "Use para taxas e comparações: taxa de confirmação, comparecimento e aproveitamento, planejados, confirmados, " +
            "recusados, atendidos — no total e agrupado por médico, município, procedimento ou mês. Padrão: últimos 30 dias.",
          parameters: [
            dateParam("de", "Primeiro dia de consulta (padrão: 29 dias atrás)."),
            dateParam("ate", "Último dia de consulta (padrão: hoje). Máximo 366 dias."),
            {
              name: "agrupar",
              in: "query",
              required: false,
              description: "Como agrupar os números.",
              schema: { type: "string", enum: ["medico", "municipio", "procedimento", "mes"], default: "medico" },
            },
          ],
          responses: objectResponse("Totais e grupos."),
        },
      },
    },
  };
}
