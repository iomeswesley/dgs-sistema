import { EmptyState, PageHeader } from "../components/AppShell";
import { StatusBand } from "../components/StatusBand";

export function Hoje() {
  // Zerado de propósito: os números vêm de Appointment assim que o disparo
  // estiver ligado. A faixa aparece aqui pra fixar o formato da leitura.
  const counts = { confirmados: 0, recusados: 0, aguardando: 0, semTelefone: 0 };

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        title="Acompanhamento"
        description="Como está a resposta das listas já disparadas, por médico e município."
      />

      <div className="card mb-6 p-5">
        <p className="eyebrow">Resumo do dia</p>
        <div className="mt-3">
          <StatusBand counts={counts} />
        </div>
      </div>

      <EmptyState
        title="Nenhum disparo até agora"
        description="Depois que uma lista revisada for disparada, cada paciente aparece aqui com a resposta do botão, o motivo da recusa e o status de entrega da mensagem."
      />
    </>
  );
}
