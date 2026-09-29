"use client";

import { ArrowLeft, KeyRound, Layers, LogOut, ShieldOff, Trash2, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Field, Input } from "@/components/ui/Field";
import { Avatar, Badge, Card, CardHeader, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CopyButton } from "@/components/ui/CopyButton";
import { AssignPlanDialog } from "./AdminWorkspace";
import { api, errorMessage } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";
import { formatBytes, formatDateTime, timeAgo } from "@/lib/format";
import type { FileDto, LimitsDto, UsageDto, UserDto } from "@/lib/types";

interface Detail {
  user: UserDto;
  counts: { files: number; folders: number; apiKeys: number; sessions: number; shares: number };
  limits: LimitsDto;
  overrides: { quotaBytes: number | null; maxFileBytes: number | null };
  suspendedReason: string | null;
  usage: UsageDto;
  recentFiles: FileDto[];
  audit: Array<{ id: string; action: string; createdAt: string; ip: string | null; actorId: string | null; targetId: string | null }>;
}

const GB = 1024 ** 3;

export function AdminUserDetail({ id, selfId }: { id: string; selfId: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const res = useResource<Detail>(`admin-user-${id}`, (signal) => api<Detail>(`/api/v1/admin/users/${id}`, { signal }));
  const d = res.data;
  const error = res.error;
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState("");
  // Empty string = "not edited yet": fall back to the stored override.
  const [quotaEdit, setQuotaEdit] = useState<string | null>(null);
  const [maxFileEdit, setMaxFileEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);
  const quota = quotaEdit ?? (d?.overrides.quotaBytes ? String(d.overrides.quotaBytes / GB) : "");
  const maxFile = maxFileEdit ?? (d?.overrides.maxFileBytes ? String(d.overrides.maxFileBytes / GB) : "");
  const setQuota = (v: string) => setQuotaEdit(v);
  const setMaxFile = (v: string) => setMaxFileEdit(v);
  const load = async () => {
    setQuotaEdit(null);
    setMaxFileEdit(null);
    res.reload();
  };

  const patch = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    try {
      await api(`/api/v1/admin/users/${id}`, { method: "PATCH", body });
      toast.success(success);
      await load();
    } catch (err) {
      toast.error("Couldn't update the user", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNotice>{error}</ErrorNotice>;
  if (!d) return <Skeleton className="h-64" />;
  const { user } = d;
  const self = user.id === selfId;

  const saveLimits = (e: FormEvent) => {
    e.preventDefault();
    const toBytes = (v: string) => (v.trim() ? Math.round(Number(v) * GB) : null);
    void patch({ quotaBytes: toBytes(quota), maxFileBytes: toBytes(maxFile) }, "Limits updated");
  };

  return (
    <div className="space-y-4">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> All users
      </Link>
      <Card>
        <div className="flex flex-wrap items-center gap-4 p-4">
          <Avatar name={user.displayName} className="size-12 text-base" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight">{user.displayName}</h1>
            <p className="text-[13px] text-muted">{user.email}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {user.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>}
              {user.role === "admin" && <Badge tone="accent">Administrator</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAssigning(true)} icon={<Layers className="size-4" aria-hidden />}>
              Plan: {user.planKey}
            </Button>
            <Button
              onClick={async () => {
                if (!(await confirm({ title: "Create a recovery link?", description: `Anyone with the link can set a new password for ${user.email} within 24 hours. Give it only to the account owner, through a channel you trust.`, confirmLabel: "Create link" }))) return;
                try {
                  const r = await api<{ link: string }>(`/api/v1/admin/users/${id}/recovery-link`, { method: "POST" });
                  setRecovery(r.link);
                } catch (err) {
                  toast.error("Couldn't create the link", errorMessage(err));
                }
              }}
              icon={<KeyRound className="size-4" aria-hidden />}
            >
              Recovery link
            </Button>
            <Button
              onClick={async () => {
                if (await confirm({ title: `Sign ${user.displayName} out everywhere?`, confirmLabel: "Revoke sessions" })) {
                  const r = await api<{ revoked: number }>(`/api/v1/admin/users/${id}/sessions`, { method: "DELETE" });
                  toast.success(`Revoked ${r.revoked} sessions`);
                  void load();
                }
              }}
              icon={<LogOut className="size-4" aria-hidden />}
            >
              Revoke sessions
            </Button>
            {user.status === "active" ? (
              <Button variant="danger-outline" disabled={self} onClick={() => setSuspending(true)} icon={<ShieldOff className="size-4" aria-hidden />}>
                Suspend
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void patch({ status: "active" }, "Account restored")} loading={busy} icon={<UserCheck className="size-4" aria-hidden />}>
                Restore
              </Button>
            )}
            <Button
              variant="danger"
              disabled={self}
              icon={<Trash2 className="size-4" aria-hidden />}
              onClick={async () => {
                if (!(await confirm({ title: `Delete ${user.email}?`, description: `This permanently erases the account and its ${d.counts.files} files (${formatBytes(d.usage.usedBytes)}). It can't be undone.`, confirmLabel: "Delete account", tone: "danger" }))) return;
                try {
                  await api(`/api/v1/admin/users/${id}`, { method: "DELETE" });
                  toast.success("Account deleted");
                  router.push("/admin/users");
                } catch (err) {
                  toast.error("Couldn't delete the account", errorMessage(err));
                }
              }}
            >
              Delete
            </Button>
          </div>
        </div>
        {user.status === "suspended" && d.suspendedReason && <p className="border-t border-line px-4 py-2.5 text-[13px] text-danger">Suspended: {d.suspendedReason}</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Usage" />
          <dl className="divide-y divide-line text-[13px]">
            {[
              ["Storage", `${formatBytes(d.usage.usedBytes)} of ${formatBytes(d.limits.quotaBytes, 0)} (${Math.round(d.usage.percent)}%)`],
              ["Files", d.counts.files.toLocaleString("en-US")],
              ["Folders", d.counts.folders.toLocaleString("en-US")],
              ["Share links", d.counts.shares.toLocaleString("en-US")],
              ["API keys", d.counts.apiKeys.toLocaleString("en-US")],
              ["Active sessions", d.counts.sessions.toLocaleString("en-US")],
              ["Joined", formatDateTime(user.createdAt)],
              ["Last sign-in", user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[9rem_1fr] gap-3 px-4 py-2">
                <dt className="text-subtle">{k}</dt>
                <dd className="tnum">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Limits & role" description="Leave a limit empty to use the site default." />
          <form onSubmit={saveLimits} className="space-y-3 p-4">
            <Field label="Storage quota (GB)" hint={`Default: ${formatBytes(d.limits.quotaBytes, 0)} currently applies.`}>
              {(p) => <Input {...p} inputMode="decimal" value={quota} onChange={(e) => setQuota(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Site default" />}
            </Field>
            <Field label="Max file size (GB)">{(p) => <Input {...p} inputMode="decimal" value={maxFile} onChange={(e) => setMaxFile(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Site default" />}</Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" loading={busy}>
                Save limits
              </Button>
              <Button
                disabled={self}
                onClick={() => void patch({ role: user.role === "admin" ? "user" : "admin" }, user.role === "admin" ? "Administrator rights removed" : "User is now an administrator")}
              >
                {user.role === "admin" ? "Remove admin rights" : "Make administrator"}
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent files" description="Names and metadata only." />
          {d.recentFiles.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">No files.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.recentFiles.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                  <Link href={`/admin/files?q=${f.id}`} className="min-w-0 truncate hover:underline">
                    {f.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted tnum">
                    {formatBytes(f.size)} · {timeAgo(f.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent audit events" actions={<Link href={`/admin/audit?actorId=${user.id}`} className="text-xs font-medium text-accent hover:underline">All</Link>} />
          {d.audit.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">No events.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.audit.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                  <code className="font-mono text-xs">{a.action}</code>
                  <span className="text-xs text-muted">
                    {a.ip ? `${a.ip} · ` : ""}
                    {timeAgo(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal
        open={suspending}
        onOpenChange={setSuspending}
        title={`Suspend ${user.displayName}?`}
        description="They are signed out immediately and can't sign in, upload or use the API. Their files stay in place but are unavailable."
        size="sm"
        footer={
          <>
            <Button onClick={() => setSuspending(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                await patch({ status: "suspended", suspendedReason: reason.trim() || null }, "Account suspended");
                setSuspending(false);
              }}
            >
              Suspend account
            </Button>
          </>
        }
      >
        <Field label="Reason" optional hint="Recorded in the audit log.">
          {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
        </Field>
      </Modal>
      {assigning && <AssignPlanDialog subject={{ type: "user", id, label: user.email }} currentPlan={user.planKey} onClose={() => setAssigning(false)} onDone={() => void load()} />}
      <Modal open={!!recovery} onOpenChange={(o) => !o && setRecovery(null)} title="Recovery link" description="Valid for 24 hours and works once. It lets whoever holds it set a new password, so treat it like a password." size="md">
        {recovery && (
          <div className="space-y-3">
            <p className="rounded-md bg-surface-2 p-3 font-mono text-xs break-all select-all">{recovery}</p>
            <div className="flex justify-end gap-2">
              <CopyButton value={recovery} label="Copy link" successMessage="Link copied" />
              <Button variant="primary" onClick={() => setRecovery(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
