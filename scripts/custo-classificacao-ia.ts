/*
  Custo/volume da classificação de resposta ambígua por IA (`classifyReplyWithAI`,
  modules/replies) — pedido do usuário em 2026-09-13, investigando um gasto de
  $0,13/dia na API da Anthropic que não tinha explicação óbvia (não tem
  relação com volume de WhatsApp enviado, que é cobrado pela Meta — só entra
  aqui quem respondeu texto livre ambíguo o bastante pra `classifyReply()`
  determinístico não resolver sozinho).

  Só lê o banco, nunca chama a API da Anthropic nem manda mensagem.

    npx tsx --env-file=.env scripts/custo-classificacao-ia.ts                # hoje
    npx tsx --env-file=.env scripts/custo-classificacao-ia.ts 2026-09-08      # um dia específico
    npx tsx --env-file=.env scripts/custo-classificacao-ia.ts 2026-09-01 7    # 7 dias terminando nessa data

  Duas gerações de dado, misturadas no mesmo relatório:
  - Chamadas ANTES do fix de 2026-09-13 (commit que passou a gravar
    aiModel/aiInputTokens/aiOutputTokens) só têm aiClassified/aiConfidence/
    aiReasoning — dá pra contar o VOLUME exato, mas não o custo em $ (por
    isso `custoConhecido: false` nessas).
  - Chamadas DEPOIS do fix têm os tokens de verdade cobrados por chamada
    (response.usage) — custo exato, sem estimativa, ver PRICE_PER_MTOK abaixo.
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { parseBrasiliaDateTime, toBrasiliaDateString, endOfBrasiliaDay } from "../src/lib/timezone.js";

function startOfBrasiliaDay(date: Date): Date {
  return parseBrasiliaDateTime(`${toBrasiliaDateString(date)}T00:00:00.000`);
}

// $ por milhão de tokens (preço oficial da Anthropic, cacheado aqui pra não
// precisar de rede) — atualizar se a Anthropic mudar o preço do modelo em
// uso (MODEL em replies.service.ts). Chamada com um modelo fora desta tabela
// (histórico de antes de uma troca, ou troca futura sem atualizar aqui)
// ainda soma no volume, só fica sem custo em $ (mesmo tratamento que uma
// chamada sem token gravado).
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
};

// Prefixos fixos que `classifyReplyWithAI()` usa quando a chamada NÃO
// terminou numa decisão real do modelo (sem API key, formato inesperado,
// recusa, erro de rede/API — a partir de 2026-09-13 alguns desses ganharam a
// mensagem de erro real anexada depois de ":", por isso é prefixo, não
// igualdade exata). Qualquer outro `reasoning` é texto livre gerado pelo
// modelo de verdade, explicando por que ele mesmo achou a mensagem
// ambígua/incerta (isso É o comportamento esperado, não falha). Separar os
// dois é o que decide se um "unknown" foi decisão de verdade ou desperdício
// de chamada — achado em 2026-09-13: 772/772 chamadas de 03/08 a 01/09
// deram "unknown", TODAS por "Falha ao consultar o classificador." (falha
// técnica, não decisão do modelo) — motivo real só ficou visível depois do
// fix que passou a incluir `err.message` nessa string.
const FAILURE_REASONING_PREFIXES = [
  "Classificação por IA desligada.",
  "Classificação recusada pelo provedor.",
  "Resposta vazia do classificador.",
  "Resposta fora do formato esperado",
  "JSON inválido devolvido pelo modelo",
  "Falha ao consultar o classificador",
];

function isFailureReasoning(reasoning: string): boolean {
  return FAILURE_REASONING_PREFIXES.some((prefix) => reasoning.startsWith(prefix));
}

interface DiaResumo {
  data: string;
  chamadas: number;
  comCustoConhecido: number;
  semCustoConhecido: number; // volume real, mas sem tokens gravados (chamada de antes do fix, ou usage null)
  custoEstimadoUsd: number;
  porModelo: Record<string, { chamadas: number; inputTokens: number; outputTokens: number; custoUsd: number }>;
  porDesfecho: Record<string, number>; // intent final gravado em raw.intent
  falhaTecnica: number; // reasoning é uma das strings fixas de erro, não decisão do modelo
  falhaTecnicaPorMotivo: Record<string, number>;
  exemplosFalha: Record<string, string[]>; // até 3 mensagens de erro reais por motivo, pra diagnóstico
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
    const messages = await prisma.whatsappMessage.findMany({
      where: {
        direction: "RECEBIDA",
        createdAt: { gte: start, lte: end },
        raw: { path: ["aiClassified"], equals: true },
      },
      select: { createdAt: true, raw: true },
      orderBy: { createdAt: "asc" },
    });

    const byDay = new Map<string, DiaResumo>();

    for (const m of messages) {
      const day = toBrasiliaDateString(m.createdAt);
      let resumo = byDay.get(day);
      if (!resumo) {
        resumo = {
          data: day,
          chamadas: 0,
          comCustoConhecido: 0,
          semCustoConhecido: 0,
          custoEstimadoUsd: 0,
          porModelo: {},
          porDesfecho: {},
          falhaTecnica: 0,
          falhaTecnicaPorMotivo: {},
          exemplosFalha: {},
        };
        byDay.set(day, resumo);
      }

      const raw = m.raw as {
        intent?: string;
        aiReasoning?: string;
        aiModel?: string;
        aiInputTokens?: number;
        aiOutputTokens?: number;
      } | null;

      resumo.chamadas++;
      const desfecho = raw?.intent ?? "desconhecido";
      resumo.porDesfecho[desfecho] = (resumo.porDesfecho[desfecho] ?? 0) + 1;

      if (raw?.aiReasoning && isFailureReasoning(raw.aiReasoning)) {
        resumo.falhaTecnica++;
        // Agrupa pelo prefixo fixo (não a string inteira) — desde o fix que
        // anexa `err.message`, cada chamada pode ter um texto ligeiramente
        // diferente (timeout vs. rate limit vs. chave inválida), e sem isso
        // cada uma virava uma chave só sua no relatório.
        const prefix =
          FAILURE_REASONING_PREFIXES.find((p) => raw.aiReasoning!.startsWith(p)) ?? raw.aiReasoning;
        resumo.falhaTecnicaPorMotivo[prefix] = (resumo.falhaTecnicaPorMotivo[prefix] ?? 0) + 1;
        if ((resumo.exemplosFalha[prefix]?.length ?? 0) < 3) {
          resumo.exemplosFalha[prefix] ??= [];
          resumo.exemplosFalha[prefix].push(raw.aiReasoning);
        }
      }

      const model = raw?.aiModel;
      const inputTokens = raw?.aiInputTokens;
      const outputTokens = raw?.aiOutputTokens;
      const price = model ? PRICE_PER_MTOK[model] : undefined;

      if (model && typeof inputTokens === "number" && typeof outputTokens === "number" && price) {
        const custoUsd = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
        resumo.comCustoConhecido++;
        resumo.custoEstimadoUsd += custoUsd;
        resumo.porModelo[model] ??= { chamadas: 0, inputTokens: 0, outputTokens: 0, custoUsd: 0 };
        resumo.porModelo[model].chamadas++;
        resumo.porModelo[model].inputTokens += inputTokens;
        resumo.porModelo[model].outputTokens += outputTokens;
        resumo.porModelo[model].custoUsd += custoUsd;
      } else {
        resumo.semCustoConhecido++;
      }
    }

    const dias = [...byDay.values()].sort((a, b) => a.data.localeCompare(b.data));
    const totalChamadas = dias.reduce((acc, d) => acc + d.chamadas, 0);
    const totalCusto = dias.reduce((acc, d) => acc + d.custoEstimadoUsd, 0);
    const totalSemCusto = dias.reduce((acc, d) => acc + d.semCustoConhecido, 0);
    const totalFalhaTecnica = dias.reduce((acc, d) => acc + d.falhaTecnica, 0);
    const falhaTecnicaPorMotivo: Record<string, number> = {};
    const exemplosFalha: Record<string, string[]> = {};
    for (const d of dias) {
      for (const [motivo, n] of Object.entries(d.falhaTecnicaPorMotivo)) {
        falhaTecnicaPorMotivo[motivo] = (falhaTecnicaPorMotivo[motivo] ?? 0) + n;
      }
      for (const [motivo, exemplos] of Object.entries(d.exemplosFalha)) {
        exemplosFalha[motivo] ??= [];
        for (const ex of exemplos) {
          if (exemplosFalha[motivo].length < 3 && !exemplosFalha[motivo].includes(ex)) exemplosFalha[motivo].push(ex);
        }
      }
    }

    const avisos: string[] = [];
    if (totalSemCusto > 0) {
      avisos.push(
        `${totalSemCusto} chamada(s) no período são de antes do fix de 2026-09-13 (não tinham aiModel/aiInputTokens/aiOutputTokens gravados) — contam no volume, mas não entram no custo em $ acima. Custo real do período é maior que totalCustoConhecidoUsd.`
      );
    }
    if (totalFalhaTecnica > 0) {
      avisos.push(
        `${totalFalhaTecnica} de ${totalChamadas} chamada(s) (${((totalFalhaTecnica / totalChamadas) * 100).toFixed(1)}%) NÃO terminaram numa decisão real do modelo — falharam tecnicamente antes disso (ver falhaTecnicaPorMotivo). Isso é gasto sem nenhum benefício: a chamada foi cobrada e o resultado caiu em "unknown" por erro, não porque a mensagem era realmente ambígua.`
      );
    }

    const report = {
      periodo: { de: toBrasiliaDateString(start), ate: toBrasiliaDateString(end) },
      totalChamadasIA: totalChamadas,
      totalCustoConhecidoUsd: Number(totalCusto.toFixed(4)),
      chamadasSemTokenGravado: totalSemCusto,
      falhaTecnicaTotal: totalFalhaTecnica,
      falhaTecnicaPorMotivo,
      exemplosFalha,
      avisos,
      porDia: dias,
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
