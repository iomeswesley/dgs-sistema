import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/*
  Modal com formulário. Complementa o ConfirmModal (que é só pergunta e
  resposta) para os casos em que a equipe precisa preencher algo antes de
  confirmar — registrar contato, lançar fechamento, cadastrar.
*/

interface FormModalProps {
  open: boolean;
  title: string;
  description?: string;
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
  children: ReactNode;
  onSubmit: () => void;
  onCancel: () => void;
}

export function FormModal({
  open,
  title,
  description,
  submitLabel = "Salvar",
  busy = false,
  error,
  children,
  onSubmit,
  onCancel,
}: FormModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Foca o primeiro campo: quem abre o modal já quer digitar. Só na
    // abertura — não pode depender de props que mudam a cada tecla
    // digitada (como `onCancel`, recriada a cada render do form), senão o
    // foco pula de volta pro primeiro campo a cada caractere.
    dialogRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-modal-title"
        className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="form-modal-title" className="text-base font-semibold text-ink">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}

        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {children}

          {error && (
            <p role="alert" className="rounded-md bg-mark-red-soft px-3 py-2 text-sm text-mark-red">
              {error}
            </p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Salvando…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
