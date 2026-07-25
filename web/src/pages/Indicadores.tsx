import { EmptyState, PageHeader } from "../components/AppShell";

const INDICATORS = [
  { label: "Confirmação", formula: "confirmados ÷ contatáveis", reading: "Eficácia do disparo" },
  { label: "Comparecimento", formula: "atendidos ÷ confirmados", reading: "Faltas de quem disse sim" },
  { label: "Aproveitamento", formula: "atendidos ÷ planejados", reading: "A visão da secretaria" },
  { label: "Divergência", formula: "pagos ÷ atendidos", reading: "Médico contra as guias" },
];

export function Indicadores() {
  return (
    <>
      <PageHeader
        eyebrow="Histórico"
        title="Indicadores"
        description="As mesmas taxas para qualquer recorte: por médico, município, procedimento e período."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {INDICATORS.map((indicator) => (
          <div key={indicator.label} className="card p-5">
            <p className="eyebrow">{indicator.label}</p>
            <p className="tabular mt-2 text-3xl font-bold tracking-tight text-ink-faint">—</p>
            <p className="mt-2 font-mono text-xs text-ink-muted">{indicator.formula}</p>
            <p className="mt-1 text-xs text-ink-faint">{indicator.reading}</p>
          </div>
        ))}
      </div>

      <EmptyState
        title="Sem histórico para comparar"
        description="Os indicadores começam a preencher depois do primeiro ciclo completo: lista disparada, respostas recebidas e fechamento lançado."
      />
    </>
  );
}
