"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/**
 * A localStorage-backed value that is safe for server rendering: the server (and the first client
 * render) use `fallback`, then React swaps in the stored value without a hydration mismatch.
 */
export function useStoredValue<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const v = localStorage.getItem(key) as T | null;
        return v && allowed.includes(v) ? v : fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );
  const set = useCallback(
    (v: T) => {
      try {
        localStorage.setItem(key, v);
      } catch {
        /* storage unavailable: the choice just won't persist */
      }
      notify();
    },
    [key],
  );
  return [value, set];
}

/** Subscribes to a document attribute that other code changes imperatively (e.g. data-theme). */
export function useDocumentAttribute(attr: string, fallback: string): string {
  return useSyncExternalStore(
    (fn) => {
      const obs = new MutationObserver(fn);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: [attr] });
      return () => obs.disconnect();
    },
    () => document.documentElement.getAttribute(attr) ?? fallback,
    () => fallback,
  );
}
