import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PageHeader } from "../components/AppShell";
import { FormModal } from "../components/FormModal";
import { Callout, ErrorNote, Field, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDateTime } from "../lib/format";

/*
  Todo mensagem trocada com o paciente, não só a parte de confirmação de
  agendamento (que já tem tela própria em Acompanhamento). Lista de
  conversas à esquerda, thread à direita — mesmo padrão visual que já existe
  nos outros projetos da DGS (barbearia-saas/odonto-saas, ver webroot/chat.html
  neles): janela de altura fixa imitando o WhatsApp de verdade, com rolagem
  só dentro do painel de mensagens, não da página inteira.

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
  everReplied: boolean;
}

interface ThreadMessage {
  id: number;
  direction: "ENVIADA" | "RECEBIDA";
  body: string | null;
  template: string | null;
  buttonPayload: string | null;
  status: string;
  createdAt: string;
  hasMedia: boolean;
  mediaMimeType: string | null;
}

type TemplateKind = "CONFIRMACAO" | "LEMBRETE" | "VAGA_ABERTA" | "CANCELAMENTO";
interface TemplateFieldsConfig {
  header?: string[];
  body: string[];
}
const TEMPLATE_LABEL: Record<TemplateKind, string> = {
  CONFIRMACAO: "Confirmação de consulta",
  LEMBRETE: "Lembrete de véspera",
  VAGA_ABERTA: "Convite pra vaga aberta",
  CANCELAMENTO: "Cancelamento",
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Mídia baixada de uma mensagem (ver `hasMedia`/`mediaMimeType` em
 * `ThreadMessage`) — imagem e áudio tocam direto na bolha; qualquer outra
 * coisa (documento, figurinha, vídeo) vira um link de abrir/baixar, porque
 * não dá pra prever o visualizador certo pra cada tipo. `url` já é
 * protegida por sessão (mesma auth de toda a API) — o navegador manda o
 * cookie sozinho num `<img>`/`<audio>` same-origin, sem precisar de token.
 */
function MediaPreview({
  url,
  mimeType,
  onOpenImage,
}: {
  url: string;
  mimeType: string | null;
  /** Clique na miniatura — abre a imagem em tamanho grande (ver <ImageLightbox>). */
  onOpenImage: (url: string) => void;
}) {
  if (mimeType?.startsWith("image/")) {
    return (
      <img
        src={url}
        alt="Imagem enviada pelo paciente"
        className="mb-1.5 max-h-64 cursor-zoom-in rounded-md object-contain"
        onClick={() => onOpenImage(url)}
      />
    );
  }
  if (mimeType?.startsWith("audio/")) {
    return (
      <audio controls className="mb-1.5 h-10 max-w-full">
        <source src={url} type={mimeType} />
      </audio>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mb-1.5 block font-semibold underline">
      📎 Abrir arquivo
    </a>
  );
}

/**
 * Imagem recebida em tamanho grande, por cima de tudo — clicar na miniatura
 * na bolha abre isso (pedido do usuário em 2026-08-27: clicar na imagem não
 * fazia nada). Fecha clicando fora, no "×" ou com Esc.
 */
function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-2xl leading-none text-white hover:bg-white/20"
        aria-label="Fechar"
      >
        ×
      </button>
      <img
        src={url}
        alt="Imagem enviada pelo paciente, em tamanho maior"
        className="max-h-full max-w-full cursor-default rounded-md object-contain"
        onClick={(event) => event.stopPropagation()}
      />
    </div>,
    document.body
  );
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
  const [search, setSearch] = useState("");
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
  // Imagem clicada na bolha — abre em tamanho grande por cima de tudo (ver
  // <ImageLightbox> mais abaixo). `null` = fechado.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Abre a conversa já no fim (mensagem mais recente), como o WhatsApp de
  // verdade — sem isso o painel abre mostrando a mensagem mais antiga.
  // Reage também a novas mensagens chegando (refresh periódico ou envio).
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [selectedPhone, thread.data?.messages.length]);

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
  const selectedName = thread.data?.patientName ?? selected?.phoneFormatted ?? selectedPhone ?? "";

  // Busca por nome (parcial, sem acento/caixa) ou telefone (só os dígitos)
  // — mesmo padrão já usado em Revisão.
  const searchDigits = search.replace(/\D/g, "");
  const searchName = search.trim().toLocaleLowerCase("pt-BR");
  const filteredConversations = (conversations.data?.conversations ?? []).filter((c) => {
    if (!searchName) return true;
    const nameMatch = (c.patientName ?? "").toLocaleLowerCase("pt-BR").includes(searchName);
    const phoneMatch = searchDigits.length > 0 && c.phone.includes(searchDigits);
    return nameMatch || phoneMatch;
  });

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

      {/* Altura fixa: a janela inteira (lista + thread) não cresce com o
          conteúdo — só o painel de mensagens rola por dentro, como no
          WhatsApp de verdade (e como já é no barbearia-saas/odonto-saas).

          No celular só uma coluna aparece por vez (lista OU conversa,
          nunca as duas — era o que cobria a tela inteira antes), com um
          "← Voltar" pra sair da conversa. A partir de md (mesmo ponto de
          quebra que o menu lateral já usa) as duas ficam lado a lado. */}
      <div className="grid h-[75vh] grid-cols-1 gap-4 overflow-hidden md:grid-cols-[320px_1fr]">
        <div
          className={`card flex-col overflow-hidden p-0 ${selectedPhone ? "hidden md:flex" : "flex"}`}
        >
          <div className="shrink-0 border-b border-rule px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-ink">Conversas</p>
            <input
              type="search"
              className="field w-full text-sm"
              placeholder="Buscar por nome ou telefone…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.loading && <Spinner />}
            {conversations.error && (
              <div className="p-3">
                <ErrorNote message={conversations.error} />
              </div>
            )}
            {conversations.data?.conversations.length === 0 && !conversations.loading && (
              <p className="p-4 text-sm text-ink-muted">Nenhuma conversa ainda.</p>
            )}
            {conversations.data && filteredConversations.length === 0 && search && (
              <p className="p-4 text-sm text-ink-muted">Nenhuma conversa encontrada pra "{search}".</p>
            )}
            {filteredConversations.map((c) => (
              <button
                key={c.phone}
                type="button"
                onClick={() => selectConversation(c)}
                className={`flex w-full items-center gap-3 border-b border-rule p-3 text-left text-sm transition-colors hover:bg-sheet-alt ${
                  selectedPhone === c.phone ? "bg-sheet-alt" : ""
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                  {initials(c.patientName ?? c.phoneFormatted)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {isUnread(c) && (
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Não lida" />
                    )}
                    <p className={`truncate ${isUnread(c) ? "font-semibold text-ink" : "font-medium text-ink"}`}>
                      {c.patientName ?? c.phoneFormatted}
                    </p>
                  </div>
                  {c.patientName && <p className="text-xs text-ink-faint">{c.phoneFormatted}</p>}
                  <p className="mt-0.5 truncate text-ink-muted">
                    {c.lastDirection === "ENVIADA" ? "Você: " : ""}
                    {c.lastMessage ?? "—"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div
          className={`flex-col overflow-hidden rounded-lg shadow-[var(--shadow-card)] ${
            selectedPhone ? "flex" : "hidden md:flex"
          }`}
        >
          {!selectedPhone && (
            <div className="flex h-full items-center justify-center bg-sheet">
              <p className="text-sm text-ink-muted">Selecione uma conversa à esquerda.</p>
            </div>
          )}

          {selectedPhone && (
            <>
              {/* Cabeçalho no estilo WhatsApp — verde-escuro, sempre com
                  texto claro (não segue o token ink, é fixo como o header
                  do app real). Botão de voltar só existe abaixo de md —
                  ali a coluna da lista some enquanto a conversa está
                  aberta, então precisa de um jeito de sair dela. */}
              <div className="flex shrink-0 items-center gap-3 bg-wa-header px-4 py-3">
                <button
                  type="button"
                  onClick={() => setSelectedPhone(null)}
                  className="-ml-1 shrink-0 rounded-full p-1 text-white/90 hover:bg-white/10 md:hidden"
                  aria-label="Voltar pra lista de conversas"
                >
                  ←
                </button>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white">
                  {initials(selectedName)}
                </span>
                {/* `flex-1`, não só `min-w-0` — mesmo ajuste de Listas.tsx
                    (2026-08-27): sem largura definida na linha flex, nome
                    de paciente comprido não é contido pela tela. */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{selectedName}</p>
                  {thread.data?.patientName && (
                    <p className="truncate text-xs text-white/70">{selected?.phoneFormatted}</p>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto bg-wa-bg p-4">
                {thread.loading && <Spinner />}
                {thread.data?.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`mb-2 flex ${m.direction === "ENVIADA" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                        m.direction === "ENVIADA"
                          ? "rounded-tr-none bg-wa-bubble-out"
                          : "rounded-tl-none bg-wa-bubble-in"
                      } text-ink`}
                    >
                      {m.hasMedia && (
                        <MediaPreview
                          url={`/api/conversations/${selectedPhone}/messages/${m.id}/media`}
                          mimeType={m.mediaMimeType}
                          onOpenImage={setLightboxUrl}
                        />
                      )}
                      <p className="whitespace-pre-wrap">
                        {m.body ?? m.buttonPayload ?? (m.template ? `[modelo: ${m.template}]` : "—")}
                      </p>
                      <p className="mt-1 text-right text-xs text-ink-faint">
                        {formatDateTime(m.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
                {thread.data && thread.data.messages.length === 0 && (
                  <p className="text-sm text-ink-muted">Nenhuma mensagem com esse número ainda.</p>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="shrink-0 bg-wa-input-bar p-3">
                {error && (
                  <div className="mb-2">
                    <ErrorNote message={error} />
                  </div>
                )}
                {!selected?.withinWindow && (
                  <div className="mb-2">
                    <Callout tone="warn">
                      {selected?.everReplied === false ? (
                        <>
                          O paciente ainda não respondeu nenhuma mensagem — a Meta só libera texto livre depois da
                          primeira resposta dele (template não abre a conversa sozinho, mesmo enviado há pouco
                          tempo).{" "}
                        </>
                      ) : (
                        <>
                          Fora da janela de 24h desde a última mensagem do paciente — a Meta só aceita template pra
                          reabrir a conversa.{" "}
                        </>
                      )}
                      <button type="button" className="font-semibold underline" onClick={openTemplateModal}>
                        Enviar template
                      </button>
                      .
                    </Callout>
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    className="field flex-1 rounded-full"
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
                    className="btn btn-primary aspect-square w-10 shrink-0 rounded-full p-0"
                    disabled={!selected?.withinWindow || sending || !text.trim()}
                    onClick={() => void send()}
                    aria-label="Enviar"
                    title="Enviar"
                  >
                    {sending ? "…" : "➤"}
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

      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </>
  );
}
