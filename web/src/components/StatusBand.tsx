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

// "semTelefone" nunca foi só sem telefone — sempre somou sem telefone +
// falha no envio + sem resposta (prazo estourado, o sistema desistiu de
// esperar). O nome "Sem telefone" escondia isso (achado em 2026-08-26,
// depois de uma lista mostrar 25 nessa faixa sendo 8 sem telefone + 17
// falha) — renomeado pra "Precisa de ação", que é o que as três têm em
// comum: nenhuma resolve sozinha, precisa de alguém mexer (completar
// telefone, reenviar, ligar). Detalhe da composição no `title` (tooltip),
// pra não estourar o espaço nos cards compactos de Listas.
const SEGMENTS = [
  { key: "confirmados", label: "Confirmados", color: "var(--mark-green)" },
  { key: "recusados", label: "Recusados", color: "var(--mark-red)" },
  { key: "aguardando", label: "Aguardando", color: "var(--mark-yellow)" },
  {
    key: "semTelefone",
    label: "Precisa de ação",
    title: "Sem telefone + falhou + estourou prazo sem resposta",
    color: "var(--mark-gray)",
  },
] as const;

export function StatusBand({
  counts,
  showLegend = true,
  unrecognizedCount = 0,
}: {
  counts: StatusCounts;
  showLegend?: boolean;
  /**
   * Linhas que a leitura nem conseguiu transformar em agendamento nenhum
   * ("Registro não reconhecido") — não são `Appointment`, não entram na
   * proporção da barra, mas também "precisam de ação" tanto quanto o resto
   * dessa faixa. Mostrado à parte ("25 + 2") pra não sumir do resumo
   * (achado em 2026-08-26).
   */
  unrecognizedCount?: number;
}) {
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
            <div
              key={segment.key}
              className="flex items-center gap-1.5 text-xs"
              title={
                "title" in segment
                  ? segment.title +
                    (segment.key === "semTelefone" && unrecognizedCount > 0
                      ? " + registro não reconhecido pela leitura (nem virou agendamento)"
                      : "")
                  : undefined
              }
            >
              <span className="h-2 w-2 rounded-full" style={{ background: segment.color }} aria-hidden />
              <span className="text-ink-muted">{segment.label}</span>
              <span className="tabular font-semibold text-ink">
                {counts[segment.key]}
                {segment.key === "semTelefone" && unrecognizedCount > 0 && (
                  <>
                    {" "}
                    + <span className="text-mark-red">{unrecognizedCount}</span>
                  </>
                )}
              </span>
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
