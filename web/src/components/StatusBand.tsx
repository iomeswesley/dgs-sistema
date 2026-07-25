/*
  A faixa de status — elemento-assinatura do sistema.

  Substitui a passada de marca-texto na lista impressa: mostra a composição
  de uma lista inteira (confirmados, recusados, aguardando, não contatáveis)
  em proporção, com as mesmas cores que a equipe já usa no papel. Aparece no
  card da lista, no acompanhamento do dia e nos indicadores — sempre com o
  mesmo significado.
*/

export interface StatusCounts {
  confirmados: number;
  recusados: number;
  aguardando: number;
  semTelefone: number;
}

const SEGMENTS = [
  { key: "confirmados", label: "Confirmados", color: "var(--mark-green)" },
  { key: "recusados", label: "Recusados", color: "var(--mark-red)" },
  { key: "aguardando", label: "Aguardando", color: "var(--mark-yellow)" },
  { key: "semTelefone", label: "Sem telefone", color: "var(--mark-gray)" },
] as const;

export function StatusBand({ counts, showLegend = true }: { counts: StatusCounts; showLegend?: boolean }) {
  const total = SEGMENTS.reduce((sum, segment) => sum + counts[segment.key], 0);

  return (
    <div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-sheet-sunken"
        role="img"
        aria-label={
          total === 0
            ? "Nenhum paciente na lista"
            : SEGMENTS.filter((s) => counts[s.key] > 0)
                .map((s) => `${counts[s.key]} ${s.label.toLowerCase()}`)
                .join(", ")
        }
      >
        {total > 0 &&
          SEGMENTS.map((segment) => {
            const value = counts[segment.key];
            if (value === 0) return null;
            return (
              <div
                key={segment.key}
                style={{ width: `${(value / total) * 100}%`, background: segment.color }}
                className="h-full"
              />
            );
          })}
      </div>

      {showLegend && (
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {SEGMENTS.map((segment) => (
            <div key={segment.key} className="flex items-center gap-1.5 text-xs">
              <span className="h-2 w-2 rounded-full" style={{ background: segment.color }} aria-hidden />
              <span className="text-ink-muted">{segment.label}</span>
              <span className="tabular font-semibold text-ink">{counts[segment.key]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Percentual de confirmação: confirmados ÷ contatáveis (quem não tem telefone não entra na conta). */
export function confirmationRate(counts: StatusCounts): number | null {
  const contactable = counts.confirmados + counts.recusados + counts.aguardando;
  if (contactable === 0) return null;
  return counts.confirmados / contactable;
}
