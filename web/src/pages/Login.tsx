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
          {/* Logo em branco sobre a moldura marinho (as faixas verde/amarelo/
              vermelho saíram: essas cores são só de status de paciente). */}
          <img src="/dgs-logo-branco.png" alt="DGS" className="mx-auto h-12 w-auto" />
          <p className="mt-4 text-[14px] text-[var(--frame-text)]">Confirmação de consultas e conciliação de atendimentos</p>
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
            <p role="alert" className="mt-4 rounded-[10px] border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3.5 py-3 text-[14px] text-[var(--danger-text)]">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary mt-5 w-full" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="mt-5 text-center text-[13px] text-[var(--frame-text)]">
          Perdeu a senha? Peça a redefinição para alguém da equipe.
        </p>
      </div>
    </div>
  );
}
