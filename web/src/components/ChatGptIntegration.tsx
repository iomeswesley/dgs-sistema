import { useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { FormModal } from "./FormModal";
import { Callout, ErrorNote, Field, Spinner, Table, Td, Th } from "./ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDateTime } from "../lib/format";

/*
  Integração com ChatGPT (pedido de 2026-11-11): token só de leitura pra um
  GPT do ChatGPT consultar os números do sistema (resumo do dia, agenda por
  data, listas, indicadores) — nunca nome/telefone de paciente. O token
  aparece uma vez só; no banco fica só o hash.
*/

interface ApiTokenRow {
  id: number;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  consultas: number;
  createdBy: { name: string } | null;
}

const GPT_INSTRUCTIONS = `Você acompanha o sistema RegulAção da DGS (confirmação de consultas por WhatsApp para secretarias de saúde de SC).
Sempre que perguntarem sobre números, situação do dia, agendas, listas, confirmações, recusas ou indicadores, consulte as ações disponíveis antes de responder — nunca invente número.
- "Como está hoje?" → resumoDoDia
- "Como está a agenda de amanhã / da semana?" → agendamentosPorDataDaConsulta
- Listas enviadas, aprovadas, disparadas → listasEnviadas
- Taxas e comparação por médico, município, procedimento ou mês → indicadores
Datas no formato AAAA-MM-DD, fuso de Brasília. Responda em português, curto, destacando o que precisa de ação (sem telefone, falha no envio, respostas para conferir, fila travada, listas paradas em revisão).`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-quiet px-2 py-1 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* sem permissão de área de transferência — a pessoa copia na mão */
        }
      }}
    >
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

export function ChatGptIntegration() {
  const tokens = useApi<{ tokens: ApiTokenRow[] }>("/api/integracoes/tokens");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiTokenRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openApiUrl = `${window.location.origin}/api/externo/openapi.json`;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ secret: string }>("/api/integracoes/tokens", { name });
      setSecret(result.secret);
      setCreating(false);
      setName("");
      tokens.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar o token.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api/integracoes/tokens/${revoking.id}`);
      setRevoking(null);
      tokens.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao revogar.");
      setRevoking(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow">Integração com ChatGPT</h2>
        <button type="button" className="btn btn-quiet" onClick={() => setCreating(true)}>
          Gerar token
        </button>
      </div>
      <p className="mb-3 text-sm text-ink-muted">
        Deixa um GPT do ChatGPT consultar os números do sistema (resumo do dia, agenda por data, listas e
        indicadores). Só leitura e só números — nunca nome ou telefone de paciente. Cada consulta fica
        contada aqui, e o token pode ser revogado a qualquer momento.
      </p>

      {secret && (
        <div className="mb-4">
          <Callout tone="warn">
            <p className="font-semibold">Token gerado — copie agora, ele não aparece de novo.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all font-mono text-sm">{secret}</code>
              <CopyButton text={secret} />
            </div>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
              <li>
                No ChatGPT: <strong>Explorar GPTs → Criar → Configurar</strong>.
              </li>
              <li>
                Em <strong>Instruções</strong>, cole o texto abaixo.
              </li>
              <li>
                Em <strong>Ações → Criar nova ação → Importar de URL</strong>, use:{" "}
                <code className="break-all font-mono">{openApiUrl}</code> <CopyButton text={openApiUrl} />
              </li>
              <li>
                Em <strong>Autenticação</strong>: <em>Chave de API</em>, tipo <em>Bearer</em>, e cole o token acima.
              </li>
              <li>
                Salve o GPT como <strong>"Somente eu"</strong> (não publique na loja de GPTs).
              </li>
            </ol>
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
                Instruções do GPT <CopyButton text={GPT_INSTRUCTIONS} />
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-current/20 p-2 text-xs">
                {GPT_INSTRUCTIONS}
              </pre>
            </div>
            <button type="button" className="btn btn-quiet mt-3" onClick={() => setSecret(null)}>
              Já copiei
            </button>
          </Callout>
        </div>
      )}

      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {tokens.loading && <Spinner />}
      {tokens.data?.tokens.length === 0 && (
        <p className="card p-6 text-center text-sm text-ink-muted">Nenhum token gerado ainda.</p>
      )}
      {(tokens.data?.tokens.length ?? 0) > 0 && (
        <Table
          head={
            <tr>
              <Th>Token</Th>
              <Th className="hidden md:table-cell">Último uso</Th>
              <Th className="hidden md:table-cell">Consultas</Th>
              <Th align="right">Ações</Th>
            </tr>
          }
        >
          {tokens.data?.tokens.map((t) => (
            <tr key={t.id} style={t.revokedAt ? { opacity: 0.55 } : undefined}>
              <Td>
                <span className="font-medium">{t.name}</span>
                <p className="font-mono text-xs text-ink-faint">{t.tokenPrefix}…</p>
                <p className="text-xs text-ink-faint">
                  {t.revokedAt
                    ? `Revogado em ${formatDateTime(t.revokedAt)}`
                    : `Criado em ${formatDateTime(t.createdAt)}${t.createdBy ? ` por ${t.createdBy.name}` : ""}`}
                </p>
                <p className="text-xs text-ink-faint md:hidden">
                  {t.lastUsedAt ? `Último uso ${formatDateTime(t.lastUsedAt)}` : "nunca usado"} · {t.consultas}{" "}
                  consulta(s)
                </p>
              </Td>
              <Td muted className="hidden md:table-cell">
                {t.lastUsedAt ? formatDateTime(t.lastUsedAt) : "nunca usado"}
              </Td>
              <Td muted className="hidden md:table-cell">
                {t.consultas}
              </Td>
              <Td align="right">
                {!t.revokedAt && (
                  <button type="button" className="btn btn-quiet px-2 py-1 text-xs" onClick={() => setRevoking(t)}>
                    Revogar
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <FormModal
        open={creating}
        title="Gerar token pro ChatGPT"
        description="O token aparece uma única vez, junto com o passo a passo pra configurar o GPT."
        submitLabel="Gerar"
        busy={busy}
        error={error}
        onSubmit={create}
        onCancel={() => setCreating(false)}
      >
        <Field label="Nome" hint="Pra saber de quem é, ex.: ChatGPT do Lucas.">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </Field>
      </FormModal>

      <ConfirmModal
        open={revoking !== null}
        title={`Revogar "${revoking?.name ?? ""}"?`}
        description="O GPT que usa este token para de conseguir consultar na hora. Pra voltar, gere um token novo e troque na configuração do GPT."
        confirmLabel="Revogar"
        danger
        busy={busy}
        onConfirm={revoke}
        onCancel={() => setRevoking(null)}
      />
    </section>
  );
}
