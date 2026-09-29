"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

/** Promise-based confirmation dialog: `if (await confirm({ title: "Delete?" })) ...` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setState({ ...options, open: true });
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setState((s) => (s ? { ...s, open: false } : s));
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={!!state?.open}
        onOpenChange={(open) => !open && settle(false)}
        title={state?.title ?? ""}
        description={state?.description}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => settle(false)}>
              {state?.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={state?.tone === "danger" ? "danger" : "primary"} onClick={() => settle(true)} autoFocus>
              {state?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}
