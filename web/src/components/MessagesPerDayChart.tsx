import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../lib/useApi";
import { daysAgo, localDateString } from "../lib/format";
import { ErrorNote, Spinner } from "./ui";

interface DailyCount {
  date: string; // YYYY-MM-DD, Brasília — nunca passar por `new Date()` direto, ver formatShortDate abaixo
  count: number;
}

const PRESETS = [
  { key: "7", label: "Última semana", days: 7 },
  { key: "30", label: "Último mês", days: 30 },
  { key: "90", label: "Últimos 3 meses", days: 90 },
] as const;

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
 * Gráfico de colunas "mensagens enviadas por dia" em Indicadores — filtro
 * próprio (semana/mês/3 meses ou intervalo livre), independente do filtro de
 * De/Até que já existe na página pro recorte por médico/município/mês
 * (pedido do usuário em 2026-09-01).
 */
export function MessagesPerDayChart() {
  const [preset, setPreset] = useState<string | null>("30");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(localDateString());

  function applyPreset(key: string, days: number) {
    setPreset(key);
    setFrom(daysAgo(days));
    setTo(localDateString());
  }

  const query = new URLSearchParams({ from, to });
  const data = useApi<{ series: DailyCount[] }>(`/api/indicators/messages-per-day?${query}`, [from, to]);
  const series = data.data?.series ?? [];
  const total = series.reduce((sum, point) => sum + point.count, 0);

  return (
    <div className="card mb-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Mensagens enviadas por dia</p>
          {!data.loading && series.length > 0 && (
            <p className="mt-0.5 text-sm text-ink-muted">
              {total} mensagens no período · {formatFullDate(from)} a {formatFullDate(to)}
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
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
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
                  formatter={(value) => [`${value} mensagens`, ""]}
                />
                <Bar dataKey="count" name="Enviadas" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={28} />
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
