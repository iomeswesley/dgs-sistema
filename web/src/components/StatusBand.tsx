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

export interface StatusSegment {
  key: string;
  label: string;
  color: string;
  title?: string;
}

/**
 * Segmentos pra lista usada como origem de cancelamento — situação de
 * MENSAGEM (ciente/enviado/precisa de ação), não de agendamento (que nessas
 * listas é sempre "Cancelado", os 4 segmentos padrão não fazem sentido
 * nenhum ali). Pedido do usuário em 2026-08-27.
 */
export const CANCELLATION_SEGMENTS: StatusSegment[] = [
  { key: "cientes", label: "Cientes", color: "var(--mark-green)" },
  { key: "enviados", label: "Enviados", color: "var(--mark-yellow)" },
  {
    key: "precisaDeAcao",
    label: "Precisa de ação",
    title: "Falhou, ou não tinha telefone cadastrado — não deu pra avisar",
    color: "var(--mark-gray)",
  },
];

export function StatusBand({
  counts,
  showLegend = true,
  unrecognizedCount = 0,
  segments = SEGMENTS,
}: {
  counts: Record<string, number>;
  showLegend?: boolean;
  /**
   * Linhas que a leitura nem conseguiu transformar em agendamento nenhum
   * ("Registro não reconhecido") — não são `Appointment`, não entram na
   * proporção da barra, mas também "precisam de ação" tanto quanto o resto
   * dessa faixa. Mostrado à parte ("25 + 2") pra não sumir do resumo
   * (achado em 2026-08-26). Só faz sentido nos segmentos padrão de
   * confirmação — listas de cancelamento não usam extração pra isso.
   */
  unrecognizedCount?: number;
  /** Segmentos a desenhar — padrão é confirmação; `CANCELLATION_SEGMENTS` pra lista usada em cancelamento. */
  segments?: readonly StatusSegment[];
}) {
  const total = segments.reduce((sum, segment) => sum + (counts[segment.key] ?? 0), 0);

  return (
    <div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-sheet-sunken"
        role="img"
        aria-label={
          total === 0
            ? "Nenhum paciente na lista"
            : segments
                .filter((s) => (counts[s.key] ?? 0) > 0)
                .map((s) => `${counts[s.key]} ${s.label.toLowerCase()}`)
                .join(", ")
        }
      >
        {total > 0 &&
          segments.map((segment) => {
            const value = counts[segment.key] ?? 0;
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
          {segments.map((segment) => (
            <div
              key={segment.key}
              className="flex items-center gap-1.5 text-xs"
              title={
                segment.title !== undefined
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
                {counts[segment.key] ?? 0}
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
