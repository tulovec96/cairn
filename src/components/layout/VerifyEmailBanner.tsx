"use client";

import { MailWarning } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { api, errorMessage } from "@/lib/api-client";

/** Shown until the address is confirmed. Verification never blocks anything; it just makes password recovery possible. */
export function VerifyEmailBanner() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setState("sending");
    try {
      await api("/api/v1/account/resend-verification", { method: "POST", body: {} });
      setState("sent");
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  };
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-[13px] text-warning">
      <MailWarning className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {state === "sent" ? "Verification message queued. Open the link in it to confirm your address." : state === "error" ? error : "Confirm your email address so you can recover your account if you forget your password."}
      </span>
      {state !== "sent" && (
        <Button size="sm" variant="secondary" onClick={send} loading={state === "sending"}>
          Send confirmation
        </Button>
      )}
    </div>
  );
}