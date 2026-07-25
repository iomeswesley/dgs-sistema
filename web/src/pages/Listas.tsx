import { EmptyState, PageHeader } from "../components/AppShell";

export function Listas() {
  return (
    <>
      <PageHeader
        eyebrow="Entrada"
        title="Listas"
        description="Cada arquivo recebido de uma prefeitura vira uma lista: extração automática, revisão da equipe e disparo das confirmações."
        actions={
          <button type="button" className="btn btn-primary" disabled>
            Enviar lista
          </button>
        }
      />

      <EmptyState
        title="Nenhuma lista ainda"
        description="Quando o envio estiver ligado, o PDF ou a foto da agenda entra aqui, é lido automaticamente e fica aguardando a revisão da equipe antes de qualquer disparo."
      />
    </>
  );
}
