import { useEffect, useState } from "react";
import { Callout } from "../components/ui";
import { SESSION_EXPIRED_KEY, useSession } from "../lib/session";

export function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Setado pelo `SessionProvider` quando uma chamada em qualquer tela volta
  // 401 no meio do uso (sessão dura 8h) — sem isso a pessoa só via um erro
  // técnico solto na tela onde estava ("Não autenticado"), sem entender
  // que bastava entrar de novo (achado pelo usuário em 2026-08-27).
  const [expiredNotice, setExpiredNotice] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_EXPIRED_KEY)) {
        sessionStorage.removeItem(SESSION_EXPIRED_KEY);
        setExpiredNotice(true);
      }
    } catch {
      // sessionStorage indisponível — só perde o aviso, tela de login continua funcionando normalmente.
    }
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-board px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {/* Mesmo chip branco do menu lateral — o logo é pra fundo claro,
              e o fundo aqui é sempre escuro (bg-board). */}
          <div className="inline-block rounded-lg bg-white px-4 py-2.5">
            <img src="/dgs-logo.png" alt="DGS" className="h-9 w-auto" />
          </div>
          <div className="mt-2 flex justify-center gap-0.5" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-mark-green" />
            <span className="h-1 w-5 rounded-full bg-mark-yellow" />
            <span className="h-1 w-3 rounded-full bg-mark-red" />
          </div>
          <p className="mt-3 text-sm text-board-ink-muted">Confirmação de consultas e conciliação de atendimentos</p>
        </div>

        {expiredNotice && (
          <div className="mb-4">
            <Callout>Sua sessão expirou. Entre novamente.</Callout>
          </div>
        )}

        <form onSubmit={handleSubmit} className="card p-6">
          <label className="block">
            <span className="eyebrow">E-mail</span>
            <input
              type="email"
              className="field mt-1.5"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </label>

          <label className="mt-4 block">
            <span className="eyebrow">Senha</span>
            <input
              type="password"
              className="field mt-1.5"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <p role="alert" className="mt-4 rounded-md bg-mark-red-soft px-3 py-2 text-sm text-mark-red">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary mt-5 w-full" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-board-ink-muted">
          Perdeu a senha? Peça a redefinição para alguém da equipe.
        </p>
      </div>
    </div>
  );
}
