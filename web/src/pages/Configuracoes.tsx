import { EmptyState, PageHeader } from "../components/AppShell";

const SECTIONS = [
  { title: "Municípios", detail: "Prefeituras atendidas, contato da secretaria e o formato de lista que cada uma manda." },
  { title: "Unidades", detail: "Onde o atendimento acontece. O endereço vai na mensagem que o paciente recebe." },
  { title: "Médicos", detail: "Quem atende, especialidade e registro." },
  { title: "Procedimentos", detail: "Nome do procedimento e o preparo enviado no lembrete de véspera." },
  {
    title: "Procedimentos por médico",
    detail: "Tempo por consulta, atendimentos esperados por dia, valor pago ao médico e valor cobrado da prefeitura.",
  },
  { title: "Equipe", detail: "Quem tem acesso ao sistema. Todo lançamento fica registrado com o nome de quem fez." },
];

export function Configuracoes() {
  return (
    <>
      <PageHeader
        eyebrow="Cadastros"
        title="Configurações"
        description="A base que o resto do sistema usa: sem médico, procedimento e valor cadastrados, o fechamento não calcula repasse nem margem."
      />

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        {SECTIONS.map((section) => (
          <div key={section.title} className="card p-5">
            <p className="text-sm font-semibold text-ink">{section.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{section.detail}</p>
          </div>
        ))}
      </div>

      <EmptyState
        title="Cadastros ainda não disponíveis"
        description="As telas acima entram na próxima etapa. Enquanto isso, os dados podem ser inseridos direto no banco."
      />
    </>
  );
}
