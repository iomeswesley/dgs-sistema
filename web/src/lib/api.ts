export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Sessão dura 8h (`cookie.maxAge` em app.ts) — quando expira no meio do
// uso, cada chamada passava a devolver o erro cru do backend ("Não
// autenticado") direto pra tela onde a pessoa estava (ex.: achado pelo
// usuário em 2026-08-27, "Não consegui pré-ler o PDF (Não autenticado)"
// em Listas — confuso, e nem avisava que era só entrar de novo). Um único
// ponto aqui detecta qualquer 401 e avisa o `SessionProvider`, que desloga
// no cliente e deixa o roteador levar pra `/entrar` sozinho (ver App.tsx).
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });

  if (res.status === 401) onUnauthorized?.();
  if (res.status === 204) return undefined as T;

  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(payload.error ?? "Não foi possível completar a ação.", res.status);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export interface SessionUser {
  id: number;
  name: string;
  email: string;
}
