"use client";

import { Download, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field, Input } from "@/components/ui/Field";
import { Badge, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useResource } from "@/lib/useResource";

interface HistoryItem {
  id: string;
  action: string;
  ip: string | null;
  device: string | null;
  reason: string | null;
  createdAt: string;
}
interface History {
  items: HistoryItem[];
  backupCodesRemaining: number;
}

const HISTORY_LABELS: Record<string, { label: string; tone: "success" | "danger" | "accent" | "warning" }> = {
  "auth.login": { label: "Signed in", tone: "success" },
  "auth.login_failed": { label: "Failed sign-in", tone: "danger" },
  "auth.password_changed": { label: "Password changed", tone: "accent" },
  "auth.password_reset": { label: "Password reset", tone: "accent" },
  "auth.2fa_enabled": { label: "Two-factor turned on", tone: "success" },
  "auth.2fa_disabled": { label: "Two-factor turned off", tone: "warning" },
  "auth.email_changed": { label: "Email changed", tone: "accent" },
};

/** Shown exactly once, right after they're generated. */
function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Cairn backup codes\nEach code works once.\n\n${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "cairn-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="rounded-lg border border-warning/40 bg-warning-soft/40 p-4">
      <h3 className="text-sm font-semibold">Save your backup codes</h3>
      <p className="mt-1 text-[13px] text-muted">If you lose your phone, each of these signs you in once. We can&apos;t show them again, so store them somewhere safe.</p>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[13px] sm:grid-cols-3" aria-label="Backup codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyButton value={text} label="Copy codes" successMessage="Codes copied" />
        <Button size="sm" onClick={download} icon={<Download className="size-4" aria-hidden />}>
          Download
        </Button>
        <Button size="sm" variant="primary" onClick={onDone}>
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}

function ReauthFields({ requireCode, password, setPassword, code, setCode }: { requireCode: boolean; password: string; setPassword: (v: string) => void; code: string; setCode: (v: string) => void }) {
  return (
    <>
      <Field label="Your password">{(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      {requireCode && (
        <Field label="Authenticator or backup code">
          {(p) => <Input {...p} inputMode="text" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
      )}
    </>
  );
}

export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const history = useResource<History>("account-history", (signal) => api<History>("/api/v1/account/history", { signal }));
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"disable" | "regenerate" | null>(null);
  const [password, setPassword] = useState("");
  const [reauthCode, setReauthCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api<{ secret: string; qrSvg: string }>("/api/v1/account/2fa", { method: "POST" }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ backupCodes: string[] }>("/api/v1/account/2fa", { method: "PUT", body: { code: code.replace(/\s/g, "") } });
      setSetup(null);
      setCode("");
      setCodes(res.backupCodes);
      toast.success("Two-factor authentication is on");
      history.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reauth = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { password, code: reauthCode.trim() || undefined };
      if (mode === "disable") {
        await api("/api/v1/account/2fa", { method: "DELETE", body });
        toast.success("Two-factor authentication is off");
        router.refresh();
      } else {
        const res = await api<{ backupCodes: string[] }>("/api/v1/account/2fa/backup-codes", { method: "POST", body });
        setCodes(res.backupCodes);
        history.reload();
      }
      setMode(null);
      setPassword("");
      setReauthCode("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <BackupCodes
        codes={codes}
        onDone={() => {
          setCodes(null);
          router.refresh();
        }}
      />
    );
  }

  if (!enabled) {
    return (
      <div className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {!setup ? (
          <>
            <p className="text-[13px] text-muted">Add a second step to sign-in with an authenticator app such as 1Password, Authy or Google Authenticator. Even if your password leaks, nobody can get in without your phone.</p>
            <Button variant="primary" loading={busy} onClick={begin} icon={<ShieldCheck className="size-4" aria-hidden />}>
              Set up two-factor
            </Button>
          </>
        ) : (
          <form onSubmit={confirm} className="space-y-4">
            <ol className="list-decimal space-y-3 pl-5 text-[13px] text-muted">
              <li>
                Scan this code with your authenticator app.
                <div className="mt-2 inline-block rounded-lg border border-line bg-white p-2" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
                <p className="mt-2 text-xs">
                  Can&apos;t scan? Enter this key instead: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-fg select-all">{setup.secret}</code>
                </p>
              </li>
              <li>Type the 6-digit code it shows to finish.</li>
            </ol>
            <Field label="6-digit code">
              {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} className="max-w-40 font-mono tracking-widest" />}
            </Field>
            <div className="flex gap-2">
              <Button onClick={() => setSetup(null)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={code.replace(/\s/g, "").length < 6}>
                Turn on
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  const remaining = history.data?.backupCodesRemaining;
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-[13px]">
        <Badge tone="success" icon={<ShieldCheck className="size-3" aria-hidden />}>
          On
        </Badge>
        <span className="text-muted">{remaining === undefined ? "" : `${remaining} backup ${remaining === 1 ? "code" : "codes"} left.`}</span>
        {remaining !== undefined && remaining <= 2 && <span className="text-warning">Generate new ones soon.</span>}
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {mode ? (
        <form onSubmit={reauth} className="space-y-3 rounded-lg border border-line bg-surface-2/50 p-4">
          <p className="text-[13px] font-medium">{mode === "disable" ? "Turn off two-factor authentication" : "Replace your backup codes"}</p>
          <p className="text-xs text-muted">{mode === "regenerate" ? "Your old codes stop working immediately." : "Your account will be protected by your password alone."} Confirm it&apos;s you first.</p>
          <ReauthFields requireCode password={password} setPassword={setPassword} code={reauthCode} setCode={setReauthCode} />
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setMode(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant={mode === "disable" ? "danger" : "primary"} loading={busy} disabled={!password || !reauthCode.trim()}>
              {mode === "disable" ? "Turn off" : "Generate new codes"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("regenerate")} icon={<KeyRound className="size-4" aria-hidden />}>
            New backup codes
          </Button>
          <Button variant="danger-outline" onClick={() => setMode("disable")} icon={<ShieldOff className="size-4" aria-hidden />}>
            Turn off
          </Button>
        </div>
      )}
    </div>
  );
}

export function EmailChangeForm({ email, verified }: { email: string; verified: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/account/email", { method: "POST", body: { email: value, password } });
      toast.success("Email changed", "Check your inbox to verify the new address.");
      setValue("");
      setPassword("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">Current address:</span> <span className="font-medium">{email}</span>
        <Badge tone={verified ? "success" : "warning"}>{verified ? "Verified" : "Not verified"}</Badge>
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Field label="New email">{(p) => <Input {...p} type="email" autoComplete="email" required value={value} onChange={(e) => setValue(e.target.value)} />}</Field>
      <Field label="Your password">{(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      <Button type="submit" variant="primary" loading={busy} disabled={!value || !password}>
        Change email
      </Button>
    </form>
  );
}

export function LoginHistory() {
  const res = useResource<History>("account-history", (signal) => api<History>("/api/v1/account/history", { signal }));
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data)
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
    );
  if (!res.data.items.length) return <p className="p-4 text-[13px] text-muted">Nothing recorded yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {res.data.items.map((h) => {
        const meta = HISTORY_LABELS[h.action] ?? { label: h.action, tone: "accent" as const };
        return (
          <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <span className="text-muted">{h.device ?? "Unknown device"}</span>
            {h.ip && <span className="font-mono text-xs text-subtle">{h.ip}</span>}
            {h.reason && <span className="text-xs text-subtle">({h.reason})</span>}
            <time className="ml-auto text-xs text-subtle tnum" dateTime={h.createdAt}>
              {formatDateTime(h.createdAt)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}

