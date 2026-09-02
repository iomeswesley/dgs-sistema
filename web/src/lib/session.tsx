import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError, setUnauthorizedHandler, type AccessibleClient, type SessionUser } from "./api";

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  /** Clientes que o usuário pode acessar — o seletor no topo (AppShell) só
   *  aparece quando tem mais de um. Quase sempre 1 item hoje ("DGS"). */
  clients: AccessibleClient[];
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  switchClient: (clientId: number) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Lido por `Login.tsx` uma vez, pra mostrar o aviso de sessão expirada. */
export const SESSION_EXPIRED_KEY = "dgs-session-expired";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [clients, setClients] = useState<AccessibleClient[]>([]);
  const [loading, setLoading] = useState(true);
  // Espelha `user` num ref porque o handler de 401 é registrado uma vez só
  // (efeito com deps vazias) e precisa do valor mais recente sem recriar o
  // handler a cada troca de usuário.
  const userRef = useRef<SessionUser | null>(null);
  userRef.current = user;

  useEffect(() => {
    // Qualquer 401 (de qualquer chamada, em qualquer tela) desloga no
    // cliente — o roteador (`App.tsx`) já leva pra `/entrar` sozinho
    // quando `user` vira `null`. Só marca "sessão expirada" (pra
    // Login.tsx avisar) quando a pessoa realmente estava logada — o
    // 401 esperado de `/api/auth/me` no primeiro carregamento (quem
    // ainda não entrou) não deve gerar esse aviso.
    setUnauthorizedHandler(() => {
      if (userRef.current) {
        try {
          sessionStorage.setItem(SESSION_EXPIRED_KEY, "1");
        } catch {
          // sessionStorage indisponível (aba privada/bloqueio) — só perde o aviso, não trava nada.
        }
      }
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    api
      .get<{ user: SessionUser; clients: AccessibleClient[] }>("/api/auth/me")
      .then((data) => {
        setUser(data.user);
        setClients(data.clients);
      })
      .catch((err) => {
        // 401 é o estado normal de quem ainda não entrou, não um erro a tratar.
        if (!(err instanceof ApiError) || err.status !== 401) console.error(err);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: SessionUser; clients: AccessibleClient[] }>("/api/auth/login", {
      email,
      password,
    });
    setUser(data.user);
    setClients(data.clients);
  }, []);

  const signOut = useCallback(async () => {
    await api.post("/api/auth/logout");
    setUser(null);
    setClients([]);
  }, []);

  const switchClient = useCallback(async (clientId: number) => {
    const data = await api.post<{ user: SessionUser }>("/api/auth/switch-client", { clientId });
    setUser(data.user);
  }, []);

  const value = useMemo(
    () => ({ user, loading, clients, signIn, signOut, switchClient }),
    [user, loading, clients, signIn, signOut, switchClient]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession precisa estar dentro de <SessionProvider>");
  return context;
}
