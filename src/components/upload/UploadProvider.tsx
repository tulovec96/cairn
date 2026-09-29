"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { UploadManager, type UploadItem } from "@/lib/upload/engine";
import type { PublicConfigDto } from "@/lib/types";

const ManagerContext = createContext<UploadManager | null>(null);
const EMPTY: UploadItem[] = [];

/** Owns the upload queue for the whole app so transfers keep going while the user navigates. */
export function UploadProvider({ children }: { children: ReactNode }) {
  const manager = useMemo(() => new UploadManager(), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/config", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ config: PublicConfigDto }>) : null))
      .then((data) => {
        if (data && !cancelled) manager.configure({ chunkConcurrency: data.config.clientConcurrency });
      })
      .catch(() => undefined);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (manager.hasActive()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [manager]);

  return <ManagerContext.Provider value={manager}>{children}</ManagerContext.Provider>;
}

export function useUploadManager(): UploadManager {
  const m = useContext(ManagerContext);
  if (!m) throw new Error("useUploadManager must be used within <UploadProvider>");
  return m;
}

export function useUploads(): UploadItem[] {
  const manager = useUploadManager();
  return useSyncExternalStore(manager.subscribe, manager.getSnapshot, () => EMPTY);
}

/** Calls `fn` whenever an upload finishes (e.g. to refresh a file list). */
export function useUploadComplete(fn: (item: UploadItem) => void) {
  const manager = useUploadManager();
  useEffect(() => manager.onComplete(fn), [manager, fn]);
}
