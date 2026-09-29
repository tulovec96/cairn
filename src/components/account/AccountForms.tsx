"use client";

import { LogOut, Monitor, Smartphone, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Field, Input } from "@/components/ui/Field";
import { Badge, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api, errorMessage } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";
import { formatDateTime, timeAgo } from "@/lib/format";
import type { SessionDto } from "@/lib/types";

export function ProfileForm({ initialName, email }: { initialName: string; email: string }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/account/profile", { method: "PATCH", body: { displayName: name } });
      toast.success("Profile updated");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Field label="Display name">{(p) => <Input {...p} value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Email" hint="Your email is your sign-in name and can't be changed here.">
        {(p) => <Input {...p} value={email} readOnly disabled />}
      </Field>
      <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || name === initialName}>
        Save changes
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const next = String(d.get("newPassword") ?? "");
    if (next !== String(d.get("confirm") ?? "")) {
      setFields({ confirm: "The passwords don't match." });
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api("/api/v1/account/password", { method: "POST", body: { currentPassword: String(d.get("currentPassword") ?? ""), newPassword: next } });
      toast.success("Password changed", "Other browsers were signed out.");
      form.reset();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFields(err.fieldErrors());
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Field label="Current password">{(p) => <Input {...p} name="currentPassword" type="password" autoComplete="current-password" required />}</Field>
      <Field label="New password" error={fields.newPassword} hint="At least 10 characters.">
        {(p) => <Input {...p} name="newPassword" type="password" autoComplete="new-password" required minLength={10} />}
      </Field>
      <Field label="Confirm new password" error={fields.confirm}>
        {(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required minLength={10} />}
      </Field>
      <Button type="submit" variant="primary" loading={busy}>
        Change password
      </Button>
    </form>
  );
}

export function DeleteAccount({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!(await confirm({ title: "Delete your account permanently?", description: "All files, folders, share links, API keys and sessions are erased immediately and can't be recovered.", confirmLabel: "Delete everything", tone: "danger" }))) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/account/delete", { method: "POST", body: { password, confirm: typed } });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="danger-outline" onClick={() => setOpen(true)} icon={<Trash2 className="size-4" aria-hidden />}>
        Delete account…
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-danger/40 bg-danger-soft/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-danger">Delete account</h3>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-muted">
          <li>Every file and folder you own is permanently deleted from storage.</li>
          <li>All share links stop working and API keys are revoked.</li>
          <li>You&apos;ll be signed out everywhere. This can&apos;t be undone.</li>
        </ul>
        {isAdmin && <p className="mt-2 text-[13px] text-warning">You&apos;re an administrator. The last administrator can&apos;t be deleted.</p>}
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Field label="Your password">{(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      <Field label='Type "DELETE" to confirm'>{(p) => <Input {...p} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" required />}</Field>
      <div className="flex gap-2">
        <Button onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="submit" variant="danger" loading={busy} disabled={typed !== "DELETE" || !password}>
          Delete my account
        </Button>
      </div>
    </form>
  );
}

function deviceLabel(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile };
}

export function SessionsManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const res = useResource("sessions", (signal) => api<{ items: SessionDto[] }>("/api/v1/account/sessions", { signal }));
  const items = res.data?.items ?? null;
  const error = res.error;
  const load = async () => res.reload();

  const revoke = async (s: SessionDto) => {
    if (!(await confirm({ title: "Sign out this device?", description: "It will need to sign in again.", confirmLabel: "Sign out" }))) return;
    try {
      await api(`/api/v1/account/sessions/${s.id}`, { method: "DELETE" });
      toast.success("Session ended");
      await load();
    } catch (err) {
      toast.error("Couldn't end the session", errorMessage(err));
    }
  };

  const revokeOthers = async () => {
    if (!(await confirm({ title: "Sign out everywhere else?", description: "Every other browser and device will be signed out.", confirmLabel: "Sign out others", tone: "danger" }))) return;
    try {
      const res = await api<{ revoked: number }>("/api/v1/account/sessions", { method: "DELETE" });
      toast.success(`Signed out ${res.revoked} other ${res.revoked === 1 ? "session" : "sessions"}`);
      await load();
    } catch (err) {
      toast.error("Couldn't sign out other sessions", errorMessage(err));
    }
  };

  return (
    <div>
      {error && <ErrorNotice className="mb-3">{error}</ErrorNotice>}
      <div className="mb-3 flex justify-end">
        <Button variant="danger-outline" onClick={revokeOthers} disabled={!items || items.length < 2} icon={<LogOut className="size-4" aria-hidden />}>
          Sign out all other sessions
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {!items ? (
          <div className="p-4">
            <Skeleton className="h-10" />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((s) => {
              const d = deviceLabel(s.userAgent);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                    {d.mobile ? <Smartphone className="size-4" aria-hidden /> : <Monitor className="size-4" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[13px] font-medium">
                      {d.label} {s.current && <Badge tone="success">This device</Badge>}
                    </p>
                    <p className="text-xs text-muted">
                      Signed in {formatDateTime(s.createdAt)} · active {timeAgo(s.lastSeenAt)}
                    </p>
                  </div>
                  {!s.current && (
                    <Button size="sm" onClick={() => revoke(s)}>
                      Sign out
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
