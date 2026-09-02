import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { useSession } from "./lib/session";
import { Login } from "./pages/Login";
import { Listas } from "./pages/Listas";
import { Revisao } from "./pages/Revisao";
import { Hoje } from "./pages/Hoje";
import { Conversas } from "./pages/Conversas";
import { Cancelamentos } from "./pages/Cancelamentos";
import { CancelamentoDetalhe } from "./pages/CancelamentoDetalhe";
import { Fechamento } from "./pages/Fechamento";
import { Indicadores } from "./pages/Indicadores";
import { Configuracoes } from "./pages/Configuracoes";
import { Equipe } from "./pages/Equipe";
import { Admin } from "./pages/Admin";

export function App() {
  const { user, loading } = useSession();

  // Evita piscar a tela de login enquanto /api/auth/me ainda está em voo.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-board">
        <p className="text-sm text-board-ink-muted">Carregando…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/entrar" element={<Login />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/listas" element={<Listas />} />
        <Route path="/listas/:id" element={<Revisao />} />
        <Route path="/hoje" element={<Hoje />} />
        <Route path="/conversas" element={<Conversas />} />
        <Route path="/cancelamentos" element={<Cancelamentos />} />
        <Route path="/cancelamentos/:id" element={<CancelamentoDetalhe />} />
        <Route path="/fechamento" element={<Fechamento />} />
        <Route path="/indicadores" element={<Indicadores />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
        <Route path="/equipe" element={<Equipe />} />
        {user.isSuperAdmin && <Route path="/admin" element={<Admin />} />}
      </Route>
      <Route path="*" element={<Navigate to="/listas" replace />} />
    </Routes>
  );
}
