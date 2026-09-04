import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MediaPreview, ImageLightbox } from "./WhatsAppMedia";
import { ErrorNote, Spinner, StatusPill } from "./ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDateTime, formatPhone } from "../lib/format";

/*
  Conversa de um paciente, aberta direto de cima de uma lista (Revisão) —
  pedido do usuário em 2026-09-03: pra ver a conversa hoje precisava copiar
  o nome, ir em Conversas, colar na busca. Aqui é um clique no nome, dentro
  da própria tela da lista.

  Não é a tela de Conversas inteira (essa continua existindo, com envio de
  mensagem/template) — é só leitura + decidir confirmado/recusado, o que
  cobre o motivo mais comum de abrir a conversa vindo da lista: conferir o
  que a pessoa respondeu antes de mexer no status dela.
*/

interface ThreadMessage {
  id: number;
  direction: "ENVIADA" | "RECEBIDA";
  body: string | null;
  template: string | null;
  buttonPayload: string | null;
  createdAt: string;
  hasMedia: boolean;
  mediaMimeType: string | null;
}

export interface ConversationAppointment {
  id: number;
  status: string;
  selectedPhone: string | null;
  patient: { name: string };
}

export function PatientConversationModal({
  appointment,
  onClose,
  onStatusChanged,
}: {
  appointment: ConversationAppointment | null;
  onClose: () => void;
  onStatusChanged: () => void;
}) {
  const open = appointment !== null;
  const phone = appointment?.selectedPhone ?? null;
  const thread = useApi<{ patientName: string | null; messages: ThreadMessage[] }>(
    open && phone ? `/api/conversations/${phone}/messages` : null,
    [phone]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [open, thread.data?.messages.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    // Cada agendamento aberto começa sem erro de uma tentativa anterior.
    setError(null);
  }, [appointment?.id]);

  if (!open || !appointment) return null;

  async function setOutcome(outcome: "CONFIRMADO" | "RECUSADO" | "SEM_RESPOSTA") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/appointments/${appointment!.id}/contact`, { outcome });
      onStatusChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 bg-wa-header px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{appointment.patient.name}</p>
            <p className="truncate text-xs text-white/70">{phone ? formatPhone(phone) : "sem telefone cadastrado"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-xl leading-none text-white/90 hover:bg-white/10"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-wa-bg p-4">
          {!phone && <p className="text-sm text-ink-muted">Sem telefone cadastrado — nenhuma mensagem foi enviada.</p>}
          {phone && thread.loading && <Spinner />}
          {phone && thread.error && <ErrorNote message={thread.error} />}
          {phone &&
            thread.data?.messages.map((m) => (
              <div key={m.id} className={`mb-2 flex ${m.direction === "ENVIADA" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                    m.direction === "ENVIADA" ? "rounded-tr-none bg-wa-bubble-out" : "rounded-tl-none bg-wa-bubble-in"
                  } text-ink`}
                >
                  {m.hasMedia && (
                    <MediaPreview
                      url={`/api/conversations/${phone}/messages/${m.id}/media`}
                      mimeType={m.mediaMimeType}
                      onOpenImage={setLightboxUrl}
                    />
                  )}
                  <p className="whitespace-pre-wrap">
                    {m.body ?? m.buttonPayload ?? (m.template ? `[modelo: ${m.template}]` : "—")}
                  </p>
                  <p className="mt-1 text-right text-xs text-ink-faint">{formatDateTime(m.createdAt)}</p>
                </div>
              </div>
            ))}
          {phone && thread.data && thread.data.messages.length === 0 && (
            <p className="text-sm text-ink-muted">Nenhuma mensagem trocada ainda.</p>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="shrink-0 bg-sheet p-3">
          {error && (
            <div className="mb-2">
              <ErrorNote message={error} />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-ink-muted">Situação</p>
              <StatusPill status={appointment.status} />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-quiet px-3 py-1.5 text-sm"
                style={{ color: "var(--mark-green)" }}
                disabled={busy}
                onClick={() => void setOutcome("CONFIRMADO")}
              >
                ✓ Confirmar
              </button>
              <button
                type="button"
                className="btn btn-quiet px-3 py-1.5 text-sm"
                style={{ color: "var(--mark-red)" }}
                disabled={busy}
                onClick={() => void setOutcome("RECUSADO")}
              >
                ✕ Recusar
              </button>
              <button
                type="button"
                className="btn btn-quiet px-3 py-1.5 text-sm"
                style={{ color: "var(--mark-gray)" }}
                disabled={busy}
                title="Desfaz um Confirmar/Recusar clicado sem querer, ou marca que a resposta não ficou clara — volta pra 'sem resposta', sem confirmação nenhuma."
                onClick={() => void setOutcome("SEM_RESPOSTA")}
              >
                ↺ Sem confirmação
              </button>
            </div>
          </div>
        </div>
      </div>

      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>,
    document.body
  );
}
