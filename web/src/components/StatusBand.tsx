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
// Ordem do handoff 1b: Confirmado → Aguardando → Recusado → Precisa de ação.
// `color` é a cor da barra (--st-X); `text` a do número na legenda.
const SEGMENTS = [
  { key: "confirmados", label: "confirmados", color: "var(--st-confirmado)", text: "var(--st-confirmado-text)" },
  { key: "aguardando", label: "aguardando", color: "var(--st-aguardando)", text: "var(--st-aguardando-text)" },
  { key: "recusados", label: "recusados", color: "var(--st-recusado)", text: "var(--st-recusado-text)" },
  {
    key: "semTelefone",
    label: "precisam de ação",
    title: "Sem telefone + falhou + estourou prazo sem resposta",
    color: "var(--st-acao)",
    text: "var(--st-acao-text)",
  },
] as const;

export interface StatusSegment {
  key: string;
  label: string;
  color: string;
  text?: string;
  title?: string;
}

/**
 * Segmentos pra lista usada como origem de cancelamento — situação de
 * MENSAGEM (ciente/enviado/precisa de ação), não de agendamento (que nessas
 * listas é sempre "Cancelado", os 4 segmentos padrão não fazem sentido
 * nenhum ali). Pedido do usuário em 2026-08-27.
 */
export const CANCELLATION_SEGMENTS: StatusSegment[] = [
  { key: "cientes", label: "cientes", color: "var(--st-confirmado)", text: "var(--st-confirmado-text)" },
  { key: "enviados", label: "enviados", color: "var(--st-aguardando)", text: "var(--st-aguardando-text)" },
  {
    key: "precisaDeAcao",
    label: "precisam de ação",
    title: "Falhou, ou não tinha telefone cadastrado — não deu pra avisar",
    color: "var(--st-acao)",
    text: "var(--st-acao-text)",
  },
];

export function StatusBand({
  counts,
  showLegend = true,
  showPercent = false,
  unrecognizedCount = 0,
  segments = SEGMENTS,
  size = "md",
}: {
  counts: Record<string, number>;
  showLegend?: boolean;
  /**
   * Mostra "· NN%" ao lado de cada número na legenda, além do valor bruto
   * — pedido do usuário em 2026-09-03 (Indicadores → Mensagens recebidas):
   * "837 confirmados" sozinho não diz se é 90% ou 20% do total. `false`
   * por padrão pra não mudar a aparência de todo santo lugar que já usa
   * `StatusBand` (Listas, Acompanhamento, Revisão, Cancelamento) sem
   * ninguém ter pedido isso lá.
   */
  showPercent?: boolean;
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
  /** Altura da barra: lg 14px (cabeçalho da Revisão), md 10px (card de lista), sm 8px (resumos). */
  size?: "lg" | "md" | "sm";
}) {
  const height = size === "lg" ? 14 : size === "sm" ? 8 : 10;
  const total = segments.reduce((sum, segment) => sum + (counts[segment.key] ?? 0), 0);

  return (
    <div>
      <div
        className="flex w-full overflow-hidden bg-[var(--surface-muted)]"
        style={{ height, borderRadius: height / 2 }}
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
                style={{ flex: value, background: segment.color }}
                className="h-full"
              />
            );
          })}
      </div>

      {showLegend && (
        <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5">
          {segments.map((segment) => (
            <div
              key={segment.key}
              className="flex items-baseline gap-1.5 text-[14px] text-[var(--text)]"
              title={
                segment.title !== undefined
                  ? segment.title +
                    (segment.key === "semTelefone" && unrecognizedCount > 0
                      ? " + registro não reconhecido pela leitura (nem virou agendamento)"
                      : "")
                  : undefined
              }
            >
              <b className="num text-[19px] font-bold" style={{ color: segment.text ?? segment.color }}>
                {counts[segment.key] ?? 0}
                {segment.key === "semTelefone" && unrecognizedCount > 0 && (
                  <span style={{ color: "var(--st-recusado-text)" }}> + {unrecognizedCount}</span>
                )}
              </b>
              <span>{segment.label}</span>
              {showPercent && total > 0 && (
                <span className="num text-[var(--text-muted)]">
                  · {Math.round(((counts[segment.key] ?? 0) / total) * 100)}%
                </span>
              )}
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
