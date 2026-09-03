import { useEffect } from "react";
import { createPortal } from "react-dom";

/*
  Miniatura de mídia recebida do paciente (imagem/áudio/outro arquivo) + o
  lightbox que abre a imagem em tamanho grande — extraído de Conversas.tsx
  em 2026-09-03 pra reaproveitar também no modal de conversa por paciente
  (Revisão), sem duplicar.
*/

export function MediaPreview({
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
 * na bolha abre isso. Fecha clicando fora, no "×" ou com Esc.
 */
export function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
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
