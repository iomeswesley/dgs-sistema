import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** GET com estado de carregamento, erro e recarga manual. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .get<T>(path)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
    // O caller informa as dependências reais em `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(reload, [reload]);

  return { data, loading, error, reload, setData };
}
