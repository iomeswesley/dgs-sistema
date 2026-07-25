import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError, type SessionUser } from "./api";

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: SessionUser }>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch((err) => {
        // 401 é o estado normal de quem ainda não entrou, não um erro a tratar.
        if (!(err instanceof ApiError) || err.status !== 401) console.error(err);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: SessionUser }>("/api/auth/login", { email, password });
    setUser(data.user);
  }, []);

  const signOut = useCallback(async () => {
    await api.post("/api/auth/logout");
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession precisa estar dentro de <SessionProvider>");
  return context;
}
