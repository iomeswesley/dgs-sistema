import { useEffect, useState } from "react";

/*
  Aba aberta há dias continua rodando o JS de quando foi carregada: o sistema
  é um SPA, navegar entre telas nunca baixa o código novo. Achado em
  2026-11-14 (prints do cliente, Camboriú): os cartões de Listas apareciam
  com o layout de antes de duas correções já publicadas — no notebook o de
  05/11, no celular o de antes disso.

  Aqui a página compara o bundle que está rodando com o que o servidor
  publica agora (`/app.html`, sem cache). Achou diferença: mostra o aviso
  com "Atualizar agora" e, na próxima troca de tela, recarrega sozinha
  (troca de tela já é o momento em que a pessoa largou o que fazia — nunca
  recarrega no meio de um formulário).
*/

const CHECK_EVERY_MS = 5 * 60 * 1000;
const BUNDLE_PATTERN = /src="(\/assets\/index-[^"]+\.js)"/;

function runningBundle(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  if (!script) return null;
  return new URL(script.src, window.location.origin).pathname;
}

async function publishedBundle(): Promise<string | null> {
  const response = await fetch("/app.html", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return null;
  return BUNDLE_PATTERN.exec(await response.text())?.[1] ?? null;
}

/** `true` quando já existe uma versão do sistema mais nova que a desta aba. */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    // Em dev (Vite) o script é /src/main.tsx, sem hash: não checa nada.
    const current = runningBundle();
    if (!current) return;

    let cancelled = false;
    const check = async () => {
      try {
        const latest = await publishedBundle();
        if (!cancelled && latest && latest !== current) setAvailable(true);
      } catch {
        // Sem rede ou servidor fora: tenta de novo na próxima vez.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    const interval = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return available;
}
