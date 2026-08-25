import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/*
  Nunca usar window.confirm()/alert() neste projeto — nem para aviso de um
  botão só. Preferência do usuário, herdada dos outros projetos: toda
  confirmação passa por aqui.

  Renderiza via portal no <body> pra funcionar mesmo dentro de linha de
  tabela ou container com overflow.
*/

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Ações destrutivas usam o vermelho de status. */
  danger?: boolean;
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
  cancelLabel = "Cancelar",
  danger = false,
  hideCancel = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Ver o mesmo comentário em FormModal.tsx: só fecha ao clicar fora quando
  // mousedown e click bateram os dois no fundo, senão selecionar texto
  // arrastando dentro do modal fecha ele sozinho no meio da seleção.
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
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
        className="card w-full max-w-md p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-modal-title" className="text-base font-semibold text-ink">
          {title}
        </h2>
        {description && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</p>}

        <div className="mt-5 flex justify-end gap-2">
          {!hideCancel && (
            <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className="btn btn-primary"
            style={danger ? { background: "var(--mark-red)" } : undefined}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Aguarde…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
