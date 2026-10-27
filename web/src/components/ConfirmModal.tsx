import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/*
  Nunca usar window.confirm()/alert() neste projeto — nem para aviso de um
  botão só. Toda confirmação passa por aqui.

  Modal do handoff 1b: overlay --overlay, caixa 560px, raio 14px. Ação
  irreversível (disparar lista, cancelar agenda) usa `irreversible`: o
  sobretítulo "AÇÃO IRREVERSÍVEL", o botão --irreversible e, quando
  `typedConfirmation` vem, o botão só habilita com o texto exato digitado.

  Renderiza via portal no <body> pra funcionar dentro de tabela/overflow.
*/

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Ação que não volta atrás (disparo, cancelamento, exclusão). */
  irreversible?: boolean;
  /** @deprecated use `irreversible` — mantido pros chamadores antigos. */
  danger?: boolean;
  /** Citação do conteúdo que vai ser enviado (ex.: texto da mensagem). */
  quote?: ReactNode;
  /** Texto que a pessoa precisa digitar pra habilitar o botão (ex.: "CANCELAR"). */
  typedConfirmation?: string;
  /** Aviso informativo de um botão só. */
  hideCancel?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Voltar",
  irreversible = false,
  danger = false,
  quote,
  typedConfirmation,
  hideCancel = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  // Só fecha ao clicar fora quando mousedown e click bateram os dois no
  // fundo — senão selecionar texto arrastando fecha o modal no meio.
  const mouseDownOnBackdrop = useRef(false);
  const isIrreversible = irreversible || danger;

  useEffect(() => {
    if (!open) return;
    setTyped("");
    (typedConfirmation ? typedRef.current : confirmRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel, typedConfirmation]);

  if (!open) return null;

  const blockedByTyping = typedConfirmation !== undefined && typed.trim() !== typedConfirmation;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4"
      onMouseDown={(event) => {
        mouseDownOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="flex max-h-[90vh] w-full max-w-[560px] flex-col gap-[18px] overflow-y-auto rounded-[14px] border border-transparent bg-[var(--surface-raised)] p-6 shadow-[var(--shadow-modal)] sm:p-7 dark:border-[var(--border)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-1.5">
          {isIrreversible && <p className="text-[13px] font-bold text-[var(--text-muted)]">AÇÃO IRREVERSÍVEL</p>}
          <h2 id="confirm-modal-title" className="text-[24px] font-bold leading-tight text-[var(--text)]">
            {title}
          </h2>
        </div>
        {description && <div className="text-[15px] leading-relaxed text-[var(--text-2)]">{description}</div>}
        {quote && (
          <div className="rounded-[10px] bg-[var(--surface-muted)] px-3.5 py-3 text-[14px] leading-relaxed text-[var(--text-2)]">
            {quote}
          </div>
        )}
        {typedConfirmation && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] text-[var(--text-2)]">
              Digite <b className="font-bold">{typedConfirmation}</b> para habilitar o botão.
            </span>
            <input
              ref={typedRef}
              className="field"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {!hideCancel && (
            <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={`btn ${isIrreversible ? "btn-irreversible" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={busy || blockedByTyping}
          >
            {busy ? "Aguarde…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
