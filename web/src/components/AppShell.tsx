import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BarChart3,
  CalendarCheck,
  CalendarX,
  ClipboardCheck,
  ClipboardList,
  Menu,
  MessageCircle,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { ConfirmModal } from "./ConfirmModal";

/*
  A prancheta: navegação escura fixa à esquerda (a prancha) e o conteúdo em
  folha clara à direita. No celular a prancha vira uma barra inferior.
*/

const NAV: { to: string; label: string; hint: string; icon: LucideIcon }[] = [
  { to: "/listas", label: "Listas", hint: "Receber e revisar", icon: ClipboardList },
  { to: "/hoje", label: "Acompanhamento", hint: "Respostas do dia", icon: CalendarCheck },
  { to: "/conversas", label: "Conversas", hint: "Mensagens do WhatsApp", icon: MessageCircle },
  { to: "/cancelamentos", label: "Cancelamento", hint: "Agenda indisponível", icon: CalendarX },
  { to: "/fechamento", label: "Fechamento", hint: "Atendidos e pagos", icon: ClipboardCheck },
  { to: "/indicadores", label: "Indicadores", hint: "Histórico e taxas", icon: BarChart3 },
  { to: "/configuracoes", label: "Configurações", hint: "Cadastros e valores", icon: Settings },
  { to: "/equipe", label: "Equipe", hint: "Acessos e auditoria", icon: UsersRound },
];

// Só quem tem `isSuperAdmin` — ver Fase 4 do PLANO-MULTICLIENTE.md. Fica
// fora do array principal (em vez de um campo condicional em cada item)
// pra não ter que filtrar `NAV` toda vez que alguém for reordenar o menu.
const ADMIN_NAV_ITEM = { to: "/admin", label: "Admin", hint: "Clientes da plataforma", icon: ShieldCheck };

const SIDEBAR_STORAGE_KEY = "dgs-sidebar-collapsed";

export function AppShell() {
  const { user, clients, switchClient, signOut } = useSession();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1"
  );
  // Só pro celular — a barra de navegação virava uma fileira com scroll
  // lateral (achado pelo usuário em 2026-08-29: "Conversas" cortado na
  // borda da tela); agora é um botão de hambúrguer que abre/fecha a lista
  // de páginas, igual um menu retrátil. Não afeta o menu lateral do desktop.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function handleSignOut() {
    await signOut();
    setConfirmingSignOut(false);
    navigate("/entrar");
  }

  return (
    <div className="min-h-screen md:flex">
      <nav
        className={`relative flex flex-col bg-board text-board-ink md:h-screen md:shrink-0 md:sticky md:top-0 md:transition-[width] md:duration-150 ${
          collapsed ? "md:w-16" : "md:w-60"
        }`}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          className="absolute -right-3 top-6 hidden h-6 w-6 items-center justify-center rounded-full border border-board-line bg-board text-board-ink-muted hover:text-board-ink md:flex"
        >
          <span aria-hidden>{collapsed ? "›" : "‹"}</span>
          <span className="sr-only">{collapsed ? "Expandir menu" : "Recolher menu"}</span>
        </button>

        <div className="flex items-center justify-between px-5 py-4 md:block md:py-6">
          <div>
            {!collapsed && (
              // O logo é desenhado pra fundo claro (letras em azul-marinho)
              // — a prancheta é sempre escura, então ele vive num chip
              // branco, não solto por cima da cor escura. Some sozinho
              // quando o menu está recolhido (pedido do usuário em
              // 2026-08-27: nada de letra solta no lugar dele).
              <div className="inline-block rounded-md bg-white px-2.5 py-1.5">
                <img src="/dgs-logo.png" alt="DGS" className="h-7 w-auto" />
              </div>
            )}
          </div>
          {/* No celular a prancheta não tem rodapé, então tema e saída ficam
              aqui — sem isso não haveria como sair da sessão no telefone. */}
          <div className="flex items-center gap-3 md:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
              className="rounded-md p-1.5 text-board-ink-muted hover:text-board-ink"
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              title={`Tema ${theme === "dark" ? "claro" : "escuro"}`}
              className="rounded-md p-1.5 text-board-ink-muted hover:text-board-ink"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              <span className="sr-only">{`Tema ${theme === "dark" ? "claro" : "escuro"}`}</span>
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

        {/* No celular só aparece com o menu aberto (painel que desce, não
            mais fileira com scroll lateral); no desktop sempre visível,
            como sempre foi. */}
        <ul
          className={`${mobileMenuOpen ? "flex" : "hidden"} flex-col gap-1 px-3 pb-3 md:flex md:gap-0.5 md:pb-0`}
        >
          {(user?.isSuperAdmin ? [...NAV, ADMIN_NAV_ITEM] : NAV).map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    [
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      collapsed ? "md:justify-center" : "",
                      isActive
                        ? "bg-accent/15 font-semibold text-accent"
                        : "text-board-ink-muted hover:bg-board-raised/60 hover:text-board-ink",
                    ].join(" ")
                  }
                >
                  <Icon size={18} className="shrink-0" aria-hidden />
                  {!collapsed && (
                    <span className="hidden min-w-0 md:block">
                      <span className="block truncate">{item.label}</span>
                      <span className="block truncate text-[0.6875rem] font-normal text-board-ink-muted">
                        {item.hint}
                      </span>
                    </span>
                  )}
                  <span className="md:hidden">{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto hidden border-t border-board-line px-5 py-4 md:block">
          <button
            type="button"
            onClick={toggleTheme}
            title={collapsed ? `Tema ${theme === "dark" ? "claro" : "escuro"}` : undefined}
            className="mb-3 flex items-center gap-2 text-xs text-board-ink-muted hover:text-board-ink"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {!collapsed && `Tema ${theme === "dark" ? "claro" : "escuro"}`}
          </button>
          {!collapsed && (
            <>
              <div className="truncate text-sm font-medium">{user?.name}</div>
              <div className="truncate text-xs text-board-ink-muted">{user?.email}</div>
              {/* Só aparece pra quem tem acesso a mais de um cliente — hoje
                  é o caso raro (quase todo mundo só tem "DGS"). Trocar
                  recarrega a página: mais simples e seguro que tentar
                  invalidar na mão todo state em cache de toda tela. */}
              {clients.length > 1 && (
                <select
                  className="field mt-2 w-full text-xs"
                  value={user?.activeClientId ?? ""}
                  onChange={async (e) => {
                    await switchClient(Number(e.target.value));
                    window.location.reload();
                  }}
                  aria-label="Cliente ativo"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setConfirmingSignOut(true)}
            title={collapsed ? "Sair" : undefined}
            className="mt-2 block text-xs text-board-ink-muted underline underline-offset-2 hover:text-board-ink"
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
