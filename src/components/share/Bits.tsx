"use client";

import { AlertTriangle, CheckCircle2, Flag, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Tip } from "@/components/ui/Overlays";
import { ApiClientError, api, errorMessage } from "@/lib/api-client";
import type { FileStatus, ScanStatus } from "@/lib/types";
import { REPORT_CATEGORIES } from "@/lib/types";
import { cn } from "@/lib/cn";

/** Honest scan state: "not scanned" is never presented as safe. */
export function ScanBadge({ scanStatus, status, className }: { scanStatus: ScanStatus; status: FileStatus; className?: string }) {
  const base = "inline-flex items-center gap-1.5 text-xs font-medium";
  if (status === "quarantined" || scanStatus === "infected") {
    return (
      <span className={cn(base, "text-danger", className)}>
        <ShieldAlert className="size-4" aria-hidden /> Blocked by security scan
      </span>
    );
  }
  if (status === "scanning" || status === "processing" || scanStatus === "pending" || scanStatus === "scanning") {
    return (
      <span className={cn(base, "text-accent", className)}>
        <Loader2 className="size-4 animate-spin" aria-hidden /> Scanning…
      </span>
    );
  }
  if (scanStatus === "clean") {
    return (
      <span className={cn(base, "text-success", className)}>
        <ShieldCheck className="size-4" aria-hidden /> Scanned, no threats found
      </span>
    );
  }
  if (scanStatus === "error") {
    return (
      <span className={cn(base, "text-warning", className)}>
        <AlertTriangle className="size-4" aria-hidden /> Scan could not be completed
      </span>
    );
  }
  return (
    <Tip label="No malware scanner is configured on this server, so this file has not been checked.">
      <span tabIndex={0} className={cn(base, "text-muted", className)}>
        <ShieldQuestion className="size-4" aria-hidden /> Not scanned
      </span>
    </Tip>
  );
}

/** Re-renders the (server) page on an interval while something is still in progress, e.g. a scan. */
export function AutoRefresh({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}

export function PasswordGate({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    setLoading(true);
    setError(null);
    try {
      await api(`/api/v1/public/shares/${token}/unlock`, { method: "POST", body: { password } });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">This link is password protected</h1>
        <p className="mt-1 text-[13px] text-muted">Enter the password you were given to see and download the file.</p>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Field label="Password">{(p) => <Input {...p} name="password" type="password" autoComplete="off" required autoFocus />}</Field>
      <Button type="submit" variant="primary" full loading={loading}>
        Unlock
      </Button>
    </form>
  );
}

export function ReportButton({ token, files }: { token: string; files?: Array<{ id: string; name: string }> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api(`/api/v1/public/shares/${token}/report`, {
        method: "POST",
        body: {
          category: String(d.get("category")),
          description: String(d.get("description") ?? ""),
          ...(d.get("contact") ? { contact: String(d.get("contact")) } : {}),
          ...(d.get("fileId") ? { fileId: String(d.get("fileId")) } : {}),
        },
      });
      setDone(true);
      toast.success("Report sent", "Thanks. An administrator will review it.");
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFields(err.fieldErrors());
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" icon={<Flag className="size-4" aria-hidden />} onClick={() => { setOpen(true); setDone(false); setError(null); }}>
        Report abuse
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Report this content" description="Tell us what's wrong. Reports are reviewed by an administrator." size="md">
        {done ? (
          <div className="flex flex-col items-center py-6 text-center">
            <CheckCircle2 className="mb-2 size-8 text-success" aria-hidden />
            <p className="text-sm font-medium">Report received</p>
            <p className="mt-1 text-[13px] text-muted">We&apos;ll look into it. You don&apos;t need to do anything else.</p>
            <Button className="mt-4" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3.5">
            {error && <ErrorNotice>{error}</ErrorNotice>}
            {files && files.length > 0 && (
              <Field label="File">
                {(p) => (
                  <Select {...p} name="fileId" required defaultValue="">
                    <option value="" disabled>
                      Choose a file…
                    </option>
                    {files.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Reason">
              {(p) => (
                <Select {...p} name="category" defaultValue="malware" required>
                  {REPORT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Details" error={fields.description}>
              {(p) => <Textarea {...p} name="description" required minLength={5} maxLength={2000} placeholder="What should the reviewer know?" />}
            </Field>
            <Field label="Your email" optional hint="Only used if we need to follow up.">
              {(p) => <Input {...p} name="contact" type="email" maxLength={200} autoComplete="email" />}
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                Send report
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
