"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "info";

interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds; 0 keeps the toast until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  toast: (t: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const ICONS = {
  success: <CheckCircle2 className="size-4 text-success" aria-hidden />,
  error: <AlertCircle className="size-4 text-danger" aria-hidden />,
  info: <Info className="size-4 text-accent" aria-hidden />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = ++seq.current;
      setItems((list) => [...list.slice(-3), { ...input, id }]);
      const duration = input.duration ?? (input.tone === "error" ? 8000 : 4500);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, tone: "success" }),
      error: (title, description) => toast({ title, description, tone: "error" }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div role="region" aria-label="Notifications" className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-3 sm:items-end sm:p-4">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cn(
              "ui-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-surface px-3.5 py-3 shadow-pop",
              t.tone === "error" ? "border-danger/40" : "border-line",
            )}
          >
            <span className="mt-0.5 shrink-0">{ICONS[t.tone ?? "info"]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-fg">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs break-words text-muted">{t.description}</p>}
              {t.action && (
                <button
                  type="button"
                  className="mt-1.5 text-xs font-medium text-accent hover:underline"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="-mr-1 shrink-0 rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
