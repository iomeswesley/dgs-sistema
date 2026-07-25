import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { ConfirmModal } from "./ConfirmModal";

/*
  A prancheta: navegação escura fixa à esquerda (a prancha) e o conteúdo em
  folha clara à direita. No celular a prancha vira uma barra inferior.
*/

const NAV = [
  { to: "/listas", label: "Listas", hint: "Receber e revisar" },
  { to: "/hoje", label: "Acompanhamento", hint: "Respostas do dia" },
  { to: "/fechamento", label: "Fechamento", hint: "Atendidos e pagos" },
  { to: "/indicadores", label: "Indicadores", hint: "Histórico e taxas" },
  { to: "/configuracoes", label: "Configurações", hint: "Cadastros e valores" },
];

export function AppShell() {
  const { user, signOut } = useSession();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  async function handleSignOut() {
    await signOut();
    setConfirmingSignOut(false);
    navigate("/entrar");
  }

  return (
    <div className="min-h-screen md:flex">
      <nav className="flex flex-col bg-board text-board-ink md:h-screen md:w-60 md:shrink-0 md:sticky md:top-0">
        <div className="flex items-center justify-between px-5 py-4 md:block md:py-6">
          <div>
            <div className="text-lg font-bold tracking-tight">DGS</div>
            <div className="mt-1 flex gap-0.5" aria-hidden>
              <span className="h-1 w-6 rounded-full bg-mark-green" />
              <span className="h-1 w-3 rounded-full bg-mark-yellow" />
              <span className="h-1 w-2 rounded-full bg-mark-red" />
            </div>
          </div>
          {/* No celular a prancheta não tem rodapé, então tema e saída ficam
              aqui — sem isso não haveria como sair da sessão no telefone. */}
          <div className="flex items-center gap-3 md:hidden">
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-md px-2 py-1 text-xs text-board-ink-muted hover:text-board-ink"
            >
              {theme === "dark" ? "Claro" : "Escuro"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingSignOut(true)}
              className="rounded-md px-2 py-1 text-xs text-board-ink-muted hover:text-board-ink"
            >
              Sair
            </button>
          </div>
        </div>

        <ul className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0">
          {NAV.map((item) => (
            <li key={item.to} className="shrink-0 md:shrink">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  [
                    "block rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-board-raised font-semibold text-board-ink"
                      : "text-board-ink-muted hover:bg-board-raised/60 hover:text-board-ink",
                  ].join(" ")
                }
              >
                {item.label}
                <span className="hidden md:block text-[0.6875rem] font-normal text-board-ink-muted">{item.hint}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="mt-auto hidden border-t border-board-line px-5 py-4 md:block">
          <button
            type="button"
            onClick={toggleTheme}
            className="mb-3 text-xs text-board-ink-muted hover:text-board-ink"
          >
            Tema {theme === "dark" ? "claro" : "escuro"}
          </button>
          <div className="truncate text-sm font-medium">{user?.name}</div>
          <div className="truncate text-xs text-board-ink-muted">{user?.email}</div>
          <button
            type="button"
            onClick={() => setConfirmingSignOut(true)}
            className="mt-2 text-xs text-board-ink-muted underline underline-offset-2 hover:text-board-ink"
          >
            Sair
          </button>
        </div>
      </nav>

      <main className="min-w-0 flex-1 bg-sheet-sunken px-4 py-6 md:px-8 md:py-8">
        <Outlet />
      </main>

      <ConfirmModal
        open={confirmingSignOut}
        title="Sair do sistema?"
        description="Você vai precisar entrar de novo com e-mail e senha."
        confirmLabel="Sair"
        onConfirm={handleSignOut}
        onCancel={() => setConfirmingSignOut(false)}
      />
    </div>
  );
}

/** Cabeçalho padrão das páginas: rótulo, título e ações. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

/** Estado vazio: diz o que vai aparecer ali e qual é o próximo passo. */
export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
