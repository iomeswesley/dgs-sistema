import { EmptyState, PageHeader } from "../components/AppShell";

const CHECKS = [
  {
    number: "Check 1",
    title: "Confirmados",
    source: "Automático, pelas respostas do WhatsApp",
    detail: "Sai direto dos botões que os pacientes clicaram. Ninguém digita.",
  },
  {
    number: "Check 2",
    title: "Atendidos",
    source: "A equipe digita o que o médico informou",
    detail: "O número que o médico passa no fim do dia, mais os encaixes que não estavam na lista.",
  },
  {
    number: "Check 3",
    title: "Pagos",
    source: "O financeiro confere nas guias",
    detail: "É o número que vira pagamento ao médico e faturamento para a prefeitura.",
  },
];

export function Fechamento() {
  return (
    <>
      <PageHeader
        eyebrow="Conciliação"
        title="Fechamento"
        description="Os três números de um mesmo dia, lado a lado. Quando eles não batem, o sistema avisa em vez de deixar passar."
      />

      {/* A numeração é literal: são três checagens em sequência, cada uma
          conferindo a anterior. */}
      <ol className="mb-6 grid gap-3 md:grid-cols-3">
        {CHECKS.map((check) => (
          <li key={check.number} className="card p-5">
            <p className="eyebrow">{check.number}</p>
            <p className="mt-1.5 text-lg font-semibold text-ink">{check.title}</p>
            <p className="mt-1 text-sm font-medium text-accent">{check.source}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{check.detail}</p>
          </li>
        ))}
      </ol>

      <EmptyState
        title="Nada para fechar ainda"
        description="A grade de lançamento aparece aqui quando houver atendimento realizado: uma linha por médico e dia, com os números do sistema ao lado dos campos que a equipe preenche."
      />
    </>
  );
}
