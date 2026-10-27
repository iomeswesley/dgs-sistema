import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BarChart3,
  CalendarCheck,
  CalendarX,
  ClipboardCheck,
  ClipboardList,
  LogOut,
  Menu,
  MessageCircle,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "../lib/session";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { ConfirmModal } from "./ConfirmModal";

/*
  Direção 1b: moldura marinho fixa à esquerda (228px) e conteúdo em cartões
  claros. Abaixo de 1024px o menu vira gaveta de 300px sobre overlay.
*/

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/listas", label: "Listas", icon: ClipboardList },
  { to: "/hoje", label: "Hoje", icon: CalendarCheck },
  { to: "/conversas", label: "Conversas", icon: MessageCircle },
  { to: "/cancelamentos", label: "Cancelamento", icon: CalendarX },
  { to: "/fechamento", label: "Fechamento", icon: ClipboardCheck },
  { to: "/indicadores", label: "Indicadores", icon: BarChart3 },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
  { to: "/equipe", label: "Equipe e auditoria", icon: UsersRound },
];

// Só quem tem `isSuperAdmin` — ver Fase 4 do PLANO-MULTICLIENTE.md.
const ADMIN_NAV_ITEM = { to: "/admin", label: "Admin", icon: ShieldCheck };

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

export function AppShell() {
  const { user, clients, switchClient, signOut } = useSession();
  const { choice, setChoice } = useTheme();
  const navigate = useNavigate();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Módulos ligados pro cliente ativo (decididos pelo super admin em /admin).
  const [modules, setModules] = useState<{ moduleCancelamento: boolean } | null>(null);
  useEffect(() => {
    api
      .get<{ features: { moduleCancelamento: boolean } }>("/api/settings")
      .then((data) => setModules(data.features))
      .catch(() => setModules(null));
  }, [user?.activeClientId]);

  const activeClient = clients.find((c) => c.id === user?.activeClientId);
  const items = (user?.isSuperAdmin ? [...NAV, ADMIN_NAV_ITEM] : NAV).filter(
    (item) => item.to !== "/cancelamentos" || modules?.moduleCancelamento !== false
  );

  async function handleSignOut() {
    await signOut();
    setConfirmingSignOut(false);
    navigate("/entrar");
  }

  const menu = (
    <>
      <div className="px-2.5 pb-[22px]">
        <img src="/dgs-logo-branco.png" alt="DGS" className="h-10 w-auto" />
      </div>
      {activeClient && (
        <div className="truncate px-2.5 pb-2.5 text-[12px] text-[#8FA0C4]">{activeClient.name}</div>
      )}

      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-2.5 rounded-[8px] px-3 py-[13px] text-[16px] transition-colors duration-[120ms] ease-out lg:py-2.5 lg:text-[15px]",
                    isActive
                      ? "bg-[var(--frame-active-bg)] font-bold text-white"
                      : "text-[var(--frame-text)] hover:bg-white/5 hover:text-white",
                  ].join(" ")
                }
              >
                <Icon size={18} strokeWidth={1.75} className="shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex flex-col gap-3 border-t border-white/10 px-2.5 pt-4">
        <div role="radiogroup" aria-label="Tema" className="flex gap-1 rounded-[8px] bg-white/5 p-1">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = choice === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setChoice(option.value)}
                title={`Tema ${option.label.toLowerCase()}`}
                className={`flex flex-1 items-center justify-center gap-1 rounded-[6px] py-1.5 text-[12px] font-bold transition-colors duration-[120ms] ease-out ${
                  selected ? "bg-[var(--frame-active-bg)] text-white" : "text-[var(--frame-text)] hover:text-white"
                }`}
              >
                <Icon size={14} aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-bold text-white">{user?.name}</div>
          <div className="truncate text-[12px] text-[var(--frame-text)]">{user?.email}</div>
        </div>
        {/* Só pra quem tem acesso a mais de um cliente. Trocar recarrega a
            página: mais simples e seguro que invalidar todo state na mão. */}
        {clients.length > 1 && (
          <select
            className="field"
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
        <button
          type="button"
          onClick={() => setConfirmingSignOut(true)}
          className="flex items-center gap-2 self-start rounded-[8px] py-1 text-[14px] font-bold text-[var(--frame-text)] hover:text-white"
        >
          <LogOut size={16} aria-hidden />
          Sair
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop: menu fixo. */}
      <nav
        aria-label="Menu principal"
        className="hidden w-[var(--sidebar-w)] shrink-0 flex-col bg-[var(--frame)] px-3 py-[22px] lg:sticky lg:top-0 lg:flex lg:h-screen lg:overflow-y-auto"
      >
        {menu}
      </nav>

      {/* Celular/tablet: barra de topo + gaveta de 300px sobre overlay. */}
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-[var(--frame)] px-3 py-1.5 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Abrir menu"
          aria-expanded={drawerOpen}
          className="flex h-11 w-11 items-center justify-center rounded-[8px] text-white"
        >
          <Menu size={22} />
        </button>
        <img src="/dgs-logo-branco.png" alt="DGS" className="h-8 w-auto" />
        {activeClient && (
          <span className="ml-auto truncate text-[12px] text-[#8FA0C4]">{activeClient.name}</span>
        )}
      </header>
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-[var(--overlay)]" onClick={() => setDrawerOpen(false)} aria-hidden />
          <nav
            aria-label="Menu principal"
            className="absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col overflow-y-auto bg-[var(--frame)] px-3.5 pb-5 pt-3"
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Fechar menu"
              className="mb-2 flex h-11 w-11 items-center justify-center self-end rounded-[8px] text-white"
            >
              <X size={22} />
            </button>
            {menu}
          </nav>
        </div>
      )}

      <main className="min-w-0 flex-1 bg-[var(--bg)] px-4 py-5 lg:px-[26px] lg:py-[22px]">
        <Outlet />
      </main>

      <ConfirmModal
        open={confirmingSignOut}
        title="Sair do sistema?"
        description="Você vai precisar entrar de novo com e-mail e senha."
        confirmLabel="Sair do sistema"
        onConfirm={handleSignOut}
        onCancel={() => setConfirmingSignOut(false)}
      />
    </div>
  );
}

/** Cabeçalho padrão das páginas: trilha/contexto, título e ações. */
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
    <header className="mb-[14px] flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        {eyebrow && <p className="text-[13px] text-[var(--text-muted)]">{eyebrow}</p>}
        <h1 className="text-[26px] font-bold leading-tight text-[var(--text)]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-muted)]">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

/** Estado vazio: diz o que vai aparecer ali e qual é o próximo passo. */
export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <p className="text-[17px] font-bold text-[var(--text)]">{title}</p>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-[var(--text-muted)]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
