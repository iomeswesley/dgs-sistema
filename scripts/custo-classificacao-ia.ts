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

interface DiaResumo {
  data: string;
  chamadas: number;
  comCustoConhecido: number;
  semCustoConhecido: number; // volume real, mas sem tokens gravados (chamada de antes do fix, ou usage null)
  custoEstimadoUsd: number;
  porModelo: Record<string, { chamadas: number; inputTokens: number; outputTokens: number; custoUsd: number }>;
  porDesfecho: Record<string, number>; // intent final gravado em raw.intent
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
        };
        byDay.set(day, resumo);
      }

      const raw = m.raw as {
        intent?: string;
        aiModel?: string;
        aiInputTokens?: number;
        aiOutputTokens?: number;
      } | null;

      resumo.chamadas++;
      const desfecho = raw?.intent ?? "desconhecido";
      resumo.porDesfecho[desfecho] = (resumo.porDesfecho[desfecho] ?? 0) + 1;

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

    const report = {
      periodo: { de: toBrasiliaDateString(start), ate: toBrasiliaDateString(end) },
      totalChamadasIA: totalChamadas,
      totalCustoConhecidoUsd: Number(totalCusto.toFixed(4)),
      chamadasSemTokenGravado: totalSemCusto,
      aviso:
        totalSemCusto > 0
          ? `${totalSemCusto} chamada(s) no período são de antes do fix de 2026-09-13 (não tinham aiModel/aiInputTokens/aiOutputTokens gravados) — contam no volume, mas não entram no custo em $ acima. Custo real do período é maior que totalCustoConhecidoUsd.`
          : null,
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
