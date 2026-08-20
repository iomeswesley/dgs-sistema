import { useEffect, useState } from "react";
import { PageHeader } from "../components/AppShell";
import { Callout, ErrorNote, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";

/*
  Todo mensagem trocada com o paciente, não só a parte de confirmação de
  agendamento (que já tem tela própria em Acompanhamento). Lista de
  conversas à esquerda, thread à direita — mesmo padrão que já existe nos
  outros projetos da DGS (barbearia-saas, odonto).

  Sem WebSocket/push: a atualização "quase ao vivo" é um refresh periódico
  simples enquanto a tela está aberta.
*/

interface ConversationSummary {
  phone: string;
  phoneFormatted: string;
  patientName: string | null;
  lastMessage: string | null;
  lastDirection: "ENVIADA" | "RECEBIDA";
  lastAt: string;
  withinWindow: boolean;
}

interface ThreadMessage {
  id: number;
  direction: "ENVIADA" | "RECEBIDA";
  body: string | null;
  template: string | null;
  status: string;
  createdAt: string;
}

const REFRESH_MS = 15_000;

export function Conversas() {
  const conversations = useApi<{ conversations: ConversationSummary[] }>("/api/conversations");
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const thread = useApi<{ patientName: string | null; messages: ThreadMessage[] }>(
    selectedPhone ? `/api/conversations/${selectedPhone}/messages` : null,
    [selectedPhone]
  );
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      conversations.reload();
      if (selectedPhone) thread.reload();
    }, REFRESH_MS);
    return () => clearInterval(interval);
    // Só reagenda quando muda a conversa selecionada — reload() em si é
    // estável entre renders (useCallback em useApi).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhone]);

  const selected = conversations.data?.conversations.find((c) => c.phone === selectedPhone);

  async function send() {
    if (!selectedPhone || !text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/api/conversations/${selectedPhone}/messages`, { text });
      setText("");
      thread.reload();
      conversations.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="WhatsApp"
        title="Conversas"
        description="Toda mensagem trocada com o paciente — não só a confirmação de agendamento."
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="card max-h-[70vh] overflow-y-auto p-0">
          {conversations.loading && <Spinner />}
          {conversations.error && (
            <div className="p-3">
              <ErrorNote message={conversations.error} />
            </div>
          )}
          {conversations.data?.conversations.length === 0 && !conversations.loading && (
            <p className="p-4 text-sm text-ink-muted">Nenhuma conversa ainda.</p>
          )}
          {conversations.data?.conversations.map((c) => (
            <button
              key={c.phone}
              type="button"
              onClick={() => setSelectedPhone(c.phone)}
              className={`block w-full border-b border-rule p-3 text-left text-sm transition-colors hover:bg-sheet-alt ${
                selectedPhone === c.phone ? "bg-sheet-alt" : ""
              }`}
            >
              <p className="font-medium text-ink">{c.patientName ?? c.phoneFormatted}</p>
              {c.patientName && <p className="text-xs text-ink-faint">{c.phoneFormatted}</p>}
              <p className="mt-1 truncate text-ink-muted">
                {c.lastDirection === "ENVIADA" ? "Você: " : ""}
                {c.lastMessage ?? "—"}
              </p>
            </button>
          ))}
        </div>

        <div className="card flex min-h-[70vh] flex-col p-0">
          {!selectedPhone && <p className="m-auto text-sm text-ink-muted">Selecione uma conversa à esquerda.</p>}

          {selectedPhone && (
            <>
              <div className="border-b border-rule p-3">
                <p className="font-medium text-ink">
                  {thread.data?.patientName ?? selected?.phoneFormatted ?? selectedPhone}
                </p>
                {thread.data?.patientName && <p className="text-xs text-ink-faint">{selected?.phoneFormatted}</p>}
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {thread.loading && <Spinner />}
                {thread.data?.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`mb-2 flex ${m.direction === "ENVIADA" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        m.direction === "ENVIADA" ? "bg-accent-soft" : "bg-sheet-sunken"
                      } text-ink`}
                    >
                      <p className="whitespace-pre-wrap">{m.body ?? (m.template ? `[modelo: ${m.template}]` : "—")}</p>
                      <p className="mt-1 text-right text-xs text-ink-faint">
                        {new Date(m.createdAt).toLocaleString("pt-BR")}
                      </p>
                    </div>
                  </div>
                ))}
                {thread.data && thread.data.messages.length === 0 && (
                  <p className="text-sm text-ink-muted">Nenhuma mensagem com esse número ainda.</p>
                )}
              </div>

              <div className="border-t border-rule p-3">
                {error && (
                  <div className="mb-2">
                    <ErrorNote message={error} />
                  </div>
                )}
                {!selected?.withinWindow && (
                  <div className="mb-2">
                    <Callout tone="warn">
                      Fora da janela de 24h desde a última mensagem do paciente — a Meta só aceita template pra
                      reabrir a conversa. Use Listas/Revisão pra reenviar uma confirmação ou lembrete.
                    </Callout>
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    className="field flex-1"
                    placeholder="Escrever mensagem…"
                    value={text}
                    disabled={!selected?.withinWindow || sending}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!selected?.withinWindow || sending || !text.trim()}
                    onClick={() => void send()}
                  >
                    {sending ? "Enviando…" : "Enviar"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
