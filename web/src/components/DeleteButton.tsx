import { useState } from "react";
import { api } from "../lib/api";
import { ConfirmModal } from "./ConfirmModal";

/*
  Botão "Excluir" de cadastro (município, unidade, médico, procedimento…).
  O backend só exclui quando nada usa o registro; senão responde 409 com o
  motivo, que aparece aqui num aviso de um botão só (sem alert()).
*/

interface DeleteButtonProps {
  /** Ex.: "Excluir o município Pomerode?" */
  title: string;
  description: string;
  /** Rota DELETE, ex.: /api/catalog/doctors/12 */
  path: string;
  onDeleted: () => void;
}

export function DeleteButton({ title, description, path, onDeleted }: DeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    try {
      await api.delete(path);
      setOpen(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-quiet px-2 py-1 text-xs text-mark-red" onClick={() => setOpen(true)}>
        Excluir
      </button>
      <ConfirmModal
        open={open}
        title={error ? "Não foi possível excluir" : title}
        description={error ?? description}
        confirmLabel={error ? "Entendi" : "Excluir"}
        hideCancel={error !== null}
        danger={error === null}
        busy={busy}
        onConfirm={() => {
          if (error) {
            setError(null);
            setOpen(false);
          } else {
            void confirm();
          }
        }}
        onCancel={() => {
          setError(null);
          setOpen(false);
        }}
      />
    </>
  );
}
