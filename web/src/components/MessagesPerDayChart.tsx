import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../lib/useApi";
import { daysAgo, localDateString } from "../lib/format";
import { ErrorNote, Spinner } from "./ui";

type TemplateKind = "CONFIRMACAO" | "LEMBRETE" | "VAGA_ABERTA" | "CANCELAMENTO";

interface DailyCount {
  date: string; // YYYY-MM-DD, Brasília — nunca passar por `new Date()` direto, ver formatShortDate abaixo
  count: number;
  byTemplate: Record<TemplateKind, number>;
}

const PRESETS = [
  { key: "7", label: "Última semana", days: 7 },
  { key: "30", label: "Último mês", days: 30 },
  { key: "90", label: "Últimos 3 meses", days: 90 },
] as const;

// Empilhado por template — pedido do usuário em 2026-09-03: antes a barra só
// mostrava o total do dia, sem dizer que tipo de mensagem era (confirmação,
// lembrete, vaga aberta, cancelamento). Cor por identidade de template
// (`--chart-*` em index.css) — por pedido explícito do usuário, essas cores
// reaproveitam de propósito o mesmo verde/amarelo/vermelho do marca-texto de
// status (cancelamento=vermelho, confirmação=verde, lembrete=amarelo), com
// azul novo só pra vaga aberta.
const TEMPLATES: { key: TemplateKind; label: string; color: string }[] = [
  { key: "CONFIRMACAO", label: "Confirmação", color: "var(--chart-confirmacao)" },
  { key: "LEMBRETE", label: "Lembrete", color: "var(--chart-lembrete)" },
  { key: "VAGA_ABERTA", label: "Vaga aberta", color: "var(--chart-vaga-aberta)" },
  { key: "CANCELAMENTO", label: "Cancelamento", color: "var(--chart-cancelamento)" },
];

/**
 * `date` já vem como string "YYYY-MM-DD" resolvida em Brasília pelo backend
 * — never `new Date(date)` aqui: o construtor interpreta a string como meia-
 * noite UTC, que em fuso negativo (Brasil) pode voltar pro dia anterior na
 * hora de formatar. Mesma classe de bug já documentada várias vezes no
 * projeto (CLAUDE.md) — evitada de propósito recortando a string, não
 * reconstruindo um Date.
 */
function formatShortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

function formatFullDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Gráfico de colunas empilhadas "mensagens enviadas por dia" em
 * Indicadores — filtro próprio (semana/mês/3 meses ou intervalo livre),
 * independente do filtro de De/Até que já existe na página pro recorte por
 * médico/município/mês (pedido do usuário em 2026-09-01). Empilhado por
 * template desde 2026-09-03.
 *
 * `clientId`: só quando quem está vendo é super admin escolhendo outro
 * cliente que não o da própria sessão (Indicadores.tsx) — nesse caso busca
 * via `/api/admin/indicators/...` em vez do endpoint normal (Fase 4).
 */
export function MessagesPerDayChart({ clientId }: { clientId?: number }) {
  const [preset, setPreset] = useState<string | null>("30");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(localDateString());

  function applyPreset(key: string, days: number) {
    setPreset(key);
    setFrom(daysAgo(days));
    setTo(localDateString());
  }

  const query = new URLSearchParams({ from, to, ...(clientId ? { clientId: String(clientId) } : {}) });
  const path = clientId ? `/api/admin/indicators/messages-per-day?${query}` : `/api/indicators/messages-per-day?${query}`;
  const data = useApi<{ series: DailyCount[] }>(path, [path]);
  const series = data.data?.series ?? [];
  const total = series.reduce((sum, point) => sum + point.count, 0);
  // Recharts precisa de campos soltos no dado, não aninhados em
  // `byTemplate`, pra cada `<Bar dataKey="CONFIRMACAO">` achar o valor.
  const chartData = series.map((point) => ({ date: point.date, ...point.byTemplate }));

  return (
    <div className="card mb-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Mensagens enviadas por dia</p>
          {!data.loading && series.length > 0 && (
            <p className="mt-0.5">
              <span className="text-2xl font-bold tabular tracking-tight text-ink">{total}</span>{" "}
              <span className="text-sm text-ink-muted">
                mensagens no período · {formatFullDate(from)} a {formatFullDate(to)}
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`btn px-2.5 py-1 text-xs ${preset === p.key ? "btn-primary" : "btn-quiet"}`}
                onClick={() => applyPreset(p.key, p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <input
              type="date"
              className="field !w-auto py-1"
              value={from}
              max={to}
              onChange={(e) => {
                setPreset(null);
                setFrom(e.target.value);
              }}
            />
            <span className="text-ink-faint">até</span>
            <input
              type="date"
              className="field !w-auto py-1"
              value={to}
              min={from}
              max={localDateString()}
              onChange={(e) => {
                setPreset(null);
                setTo(e.target.value);
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        {data.loading && <Spinner />}
        {data.error && <ErrorNote message={data.error} />}
        {!data.loading && !data.error && series.length > 0 && total > 0 && (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
                  axisLine={{ stroke: "var(--rule)" }}
                  tickLine={false}
                  // Muitos pontos (90 dias) não cabem um a um — pula ticks
                  // sozinho em vez de sobrepor texto ilegível.
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip
                  cursor={{ fill: "var(--sheet-alt)" }}
                  contentStyle={{
                    background: "var(--sheet)",
                    border: "1px solid var(--rule)",
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                  labelFormatter={(value) => formatFullDate(String(value))}
                  // Some template com 0 nesse dia não aparece na lista do tooltip.
                  formatter={(value, name) => (Number(value) > 0 ? [`${value} mensagens`, name] : undefined)}
                />
                <Legend
                  formatter={(value) => <span style={{ color: "var(--ink-muted)", fontSize: 12 }}>{value}</span>}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ paddingTop: 8 }}
                />
                {TEMPLATES.map((t, i) => (
                  <Bar
                    key={t.key}
                    dataKey={t.key}
                    name={t.label}
                    stackId="templates"
                    fill={t.color}
                    maxBarSize={28}
                    // Só o segmento do topo da pilha arredonda — os demais
                    // ficam quadrados, com um traço fino da cor do fundo
                    // entre eles (o "espaçamento" que separa cada segmento
                    // visualmente, já que barra empilhada não tem gap real).
                    radius={i === TEMPLATES.length - 1 ? [3, 3, 0, 0] : 0}
                    stroke="var(--sheet)"
                    strokeWidth={2}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {!data.loading && !data.error && total === 0 && (
          <p className="text-sm text-ink-muted">Nenhuma mensagem enviada nesse período.</p>
        )}
      </div>
    </div>
  );
}
