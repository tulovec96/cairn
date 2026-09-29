"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api-client";

interface Loaded<T> {
  key: string;
  tick: number;
  data: T | null;
  error: string | null;
}

export interface Resource<T> {
  /** Data for the current `key`; null while the first load for that key is in flight. */
  data: T | null;
  error: string | null;
  /** True until the first result for the current key arrives. */
  loading: boolean;
  /** True while a reload (same key) is in flight; `data` still shows the previous result. */
  refreshing: boolean;
  reload: () => void;
  /** Replace the cached data for the current key (e.g. after a mutation returned fresh data). */
  mutate: (data: T | ((prev: T | null) => T | null)) => void;
}

/**
 * Loads data whenever `key` changes (or `reload()` is called). All state updates happen in promise
 * callbacks, and results from a previous key are never shown for the current one.
 */
export function useResource<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>): Resource<T> {
  const [state, setState] = useState<Loaded<T>>({ key: "\u0000", tick: -1, data: null, error: null });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    const ctrl = new AbortController();
    fetcherRef.current(ctrl.signal).then(
      (data) => setState({ key, tick, data, error: null }),
      (err) => {
        if ((err as Error).name === "AbortError") return;
        setState((prev) => ({ key, tick, data: prev.key === key ? prev.data : null, error: errorMessage(err) }));
      },
    );
    return () => ctrl.abort();
  }, [key, tick]);

  const current = state.key === key;
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const mutate = useCallback<Resource<T>["mutate"]>(
    (next) => setState((prev) => ({ ...prev, key, data: typeof next === "function" ? (next as (p: T | null) => T | null)(prev.key === key ? prev.data : null) : next })),
    [key],
  );
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !current || (state.data === null && state.error === null),
    refreshing: current && state.tick !== tick,
    reload,
    mutate,
  };
}
