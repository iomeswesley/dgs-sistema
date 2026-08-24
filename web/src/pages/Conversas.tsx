import { useEffect, useState } from "react";
import { PageHeader } from "../components/AppShell";
import { FormModal } from "../components/FormModal";
import { Callout, ErrorNote, Field, Spinner } from "../components/ui";
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
  buttonPayload: string | null;
  status: string;
  createdAt: string;
}

type TemplateKind = "CONFIRMACAO" | "LEMBRETE" | "VAGA_ABERTA";
interface TemplateFieldsConfig {
  header?: string[];
  body: string[];
}
const TEMPLATE_LABEL: Record<TemplateKind, string> = {
  CONFIRMACAO: "Confirmação de consulta",
  LEMBRETE: "Lembrete de véspera",
  VAGA_ABERTA: "Convite pra vaga aberta",
};

const REFRESH_MS = 15_000;
// Marca "vista" por navegador/pessoa (perfil único, sem conta por usuário
// separada pra isso) — não sincroniza entre quem está na equipe, mas
// resolve o caso comum de "voltei nessa tela, o que é novo desde a
// última vez que eu olhei".
const SEEN_STORAGE_KEY = "dgs-conversas-seen";

function loadSeenMap(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function Conversas() {
  const conversations = useApi<{ conversations: ConversationSummary[] }>("/api/conversations");
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const thread = useApi<{ patientName: string | null; messages: ThreadMessage[] }>(
    selectedPhone ? `/api/conversations/${selectedPhone}/messages` : null,
    [selectedPhone]
  );
  const templateFields = useApi<{ fields: Record<TemplateKind, TemplateFieldsConfig> }>(
    "/api/conversations/template-fields"
  );
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Record<string, string>>(() => loadSeenMap());

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateKind, setTemplateKind] = useState<TemplateKind>("CONFIRMACAO");
  const [headerValues, setHeaderValues] = useState<string[]>([]);
  const [bodyValues, setBodyValues] = useState<string[]>([]);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

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

  function selectConversation(c: ConversationSummary) {
    setSelectedPhone(c.phone);
    const next = { ...seen, [c.phone]: c.lastAt };
    setSeen(next);
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(next));
  }

  function isUnread(c: ConversationSummary): boolean {
    if (c.lastDirection !== "RECEBIDA") return false;
    const lastSeen = seen[c.phone];
    return !lastSeen || new Date(c.lastAt).getTime() > new Date(lastSeen).getTime();
  }

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

  function openTemplateModal() {
    const fields = templateFields.data?.fields[templateKind];
    setHeaderValues(new Array(fields?.header?.length ?? 0).fill(""));
    setBodyValues(new Array(fields?.body.length ?? 0).fill(""));
    setTemplateError(null);
    setTemplateModalOpen(true);
  }

  function changeTemplateKind(kind: TemplateKind) {
    setTemplateKind(kind);
    const fields = templateFields.data?.fields[kind];
    setHeaderValues(new Array(fields?.header?.length ?? 0).fill(""));
    setBodyValues(new Array(fields?.body.length ?? 0).fill(""));
  }

  async function sendTemplateMessage() {
    if (!selectedPhone) return;
    setTemplateBusy(true);
    setTemplateError(null);
    try {
      await api.post(`/api/conversations/${selectedPhone}/template`, {
        template: templateKind,
        header: headerValues.length ? headerValues : undefined,
        body: bodyValues,
      });
      setTemplateModalOpen(false);
      thread.reload();
      conversations.reload();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Falha ao enviar template.");
    } finally {
      setTemplateBusy(false);
    }
  }

  const activeFields = templateFields.data?.fields[templateKind];

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
              onClick={() => selectConversation(c)}
              className={`block w-full border-b border-rule p-3 text-left text-sm transition-colors hover:bg-sheet-alt ${
                selectedPhone === c.phone ? "bg-sheet-alt" : ""
              }`}
            >
              <div className="flex items-center gap-1.5">
                {isUnread(c) && (
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Não lida" />
                )}
                <p className={`truncate ${isUnread(c) ? "font-semibold text-ink" : "font-medium text-ink"}`}>
                  {c.patientName ?? c.phoneFormatted}
                </p>
              </div>
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
                      <p className="whitespace-pre-wrap">
                        {m.body ?? m.buttonPayload ?? (m.template ? `[modelo: ${m.template}]` : "—")}
                      </p>
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
                      reabrir a conversa.{" "}
                      <button type="button" className="font-semibold underline" onClick={openTemplateModal}>
                        Enviar template
                      </button>
                      .
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

      <FormModal
        open={templateModalOpen}
        title="Enviar template"
        description="Reabre a conversa fora da janela de 24h. Preencha as variáveis igual apareceriam pro paciente."
        busy={templateBusy}
        error={templateError}
        onSubmit={sendTemplateMessage}
        onCancel={() => setTemplateModalOpen(false)}
      >
        <Field label="Template">
          <select
            className="field"
            value={templateKind}
            onChange={(e) => changeTemplateKind(e.target.value as TemplateKind)}
          >
            {(Object.keys(TEMPLATE_LABEL) as TemplateKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {TEMPLATE_LABEL[kind]}
              </option>
            ))}
          </select>
        </Field>
        {activeFields?.header?.map((label, i) => (
          <Field key={`header-${i}`} label={label}>
            <input
              className="field"
              value={headerValues[i] ?? ""}
              onChange={(e) => setHeaderValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
              required
            />
          </Field>
        ))}
        {activeFields?.body.map((label, i) => (
          <Field key={`body-${i}`} label={label}>
            <input
              className="field"
              value={bodyValues[i] ?? ""}
              onChange={(e) => setBodyValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
              required
            />
          </Field>
        ))}
      </FormModal>
    </>
  );
}
