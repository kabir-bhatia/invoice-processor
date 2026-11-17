import { useCallback, useEffect, useRef, useState } from "react";

export interface Async<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (v: T) => void;
}

/** Fetch on mount and whenever deps change. Optional polling keeps live rows moving. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number | false): Async<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const gen = useRef(0);

  const reload = useCallback(async () => {
    const g = ++gen.current;
    try {
      const v = await fnRef.current();
      if (g === gen.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (g === gen.current) setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => void reload(), pollMs);
    return () => clearInterval(t);
  }, [pollMs, reload]);

  return { data, error, loading, reload, setData };
}
