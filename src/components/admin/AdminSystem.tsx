"use client";

import { DatabaseBackup, Mail, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Badge, Card, CardHeader, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatBytes, formatDateTime, timeAgo } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import { useCursorList } from "./useCursorList";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" | "warning" }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs text-subtle">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight tnum ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : ""}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24" />
      <Skeleton className="h-48" />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

interface Job {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAt: string;
  createdAt: string;
  finishedAt: string | null;
}
interface JobList {
  counts: Record<string, number>;
  oldestQueuedAt: string | null;
  items: Job[];
  nextCursor: string | null;
}

const JOB_TONE: Record<string, "success" | "danger" | "accent" | "neutral"> = { done: "success", failed: "danger", running: "accent", queued: "neutral" };

export function AdminJobs() {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState("all");
  const [now, setNow] = useState(() => Date.now());
  const first = useResource<JobList>(`jobs:${status}`, (signal) => api<JobList>(`/api/v1/admin/jobs?status=${status}&limit=40`, { signal }));
  const list = useCursorList<Job>("/api/v1/admin/jobs", { status });
  const { reload } = first;
  const { reload: reloadList } = list;

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      reload();
      reloadList();
    }, 10_000);
    return () => clearInterval(t);
  }, [reload, reloadList]);

  const retry = async (id: string) => {
    try {
      await api(`/api/v1/admin/jobs/${id}/retry`, { method: "POST" });
      toast.success("Job re-queued");
      reload();
      reloadList();
    } catch (err) {
      toast.error("Couldn't retry", errorMessage(err));
    }
  };
  const retryAll = async () => {
    if (!(await confirm({ title: "Re-queue every failed job?", confirmLabel: "Retry all" }))) return;
    try {
      const r = await api<{ requeued: number }>("/api/v1/admin/jobs/retry", { method: "POST" });
      toast.success(`Re-queued ${r.requeued} ${r.requeued === 1 ? "job" : "jobs"}`);
      reload();
      reloadList();
    } catch (err) {
      toast.error("Couldn't retry", errorMessage(err));
    }
  };

  if (first.error) return <ErrorNotice>{first.error}</ErrorNotice>;
  if (!first.data) return <Loading />;
  const c = first.data.counts;
  const lag = first.data.oldestQueuedAt ? now - new Date(first.data.oldestQueuedAt).getTime() : 0;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Queued" value={(c.queued ?? 0).toLocaleString("en-US")} sub={first.data.oldestQueuedAt ? `oldest waiting ${timeAgo(first.data.oldestQueuedAt)}` : "queue is empty"} tone={lag > 5 * 60_000 ? "warning" : undefined} />
        <Stat label="Running" value={(c.running ?? 0).toLocaleString("en-US")} />
        <Stat label="Failed" value={(c.failed ?? 0).toLocaleString("en-US")} tone={(c.failed ?? 0) > 0 ? "danger" : undefined} />
        <Stat label="Completed" value={(c.done ?? 0).toLocaleString("en-US")} sub="older ones are pruned" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Job status" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {["all", "queued", "running", "failed", "done"].map((s) => (
            <button key={s} role="tab" type="button" aria-selected={status === s} onClick={() => setStatus(s)} className={`rounded-md px-3 py-1.5 text-[13px] font-medium capitalize ${status === s ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
              {s}
            </button>
          ))}
        </div>
        <Button onClick={retryAll} disabled={!(c.failed ?? 0)} icon={<RotateCw className="size-4" aria-hidden />}>
          Retry all failed
        </Button>
      </div>
      {list.error && <ErrorNotice>{list.error}</ErrorNotice>}
      <div role="region" aria-label="Jobs" tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-xs text-subtle">
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Attempts</th>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Detail</th>
              <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(list.items ?? []).map((j) => (
              <tr key={j.id}>
                <td className="px-4 py-2 font-mono text-xs">{j.type}</td>
                <td className="px-3 py-2">
                  <Badge tone={JOB_TONE[j.status] ?? "neutral"}>{j.status}</Badge>
                </td>
                <td className="px-3 py-2 tnum">
                  {j.attempts}/{j.maxAttempts}
                </td>
                <td className="px-3 py-2 text-muted" title={formatDateTime(j.createdAt)}>
                  {timeAgo(j.createdAt)}
                </td>
                <td className="max-w-xs truncate px-3 py-2 text-xs text-danger" title={j.lastError ?? undefined}>
                  {j.lastError}
                </td>
                <td className="px-3 py-2 text-right">{j.status === "failed" && <Button size="sm" onClick={() => retry(j.id)}>Retry</Button>}</td>
              </tr>
            ))}
            {list.items?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  No jobs match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {list.hasMore && (
        <div className="flex justify-center">
          <Button onClick={list.loadMore} loading={list.loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

interface ApiOverview {
  requests24h: number;
  serverErrors24h: number;
  requests7d: number;
  activeKeys: number;
  topUsers: Array<{ userId: string; email: string; requests: number }>;
  endpoints: Array<{ endpoint: string; method: string; requests: number; avgLatencyMs: number }>;
}

export function AdminApi() {
  const res = useResource<ApiOverview>("admin-api", (signal) => api<ApiOverview>("/api/v1/admin/api", { signal }));
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Loading />;
  const a = res.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Requests, 24 h" value={a.requests24h.toLocaleString("en-US")} />
        <Stat label="Server errors, 24 h" value={a.serverErrors24h.toLocaleString("en-US")} tone={a.serverErrors24h > 0 ? "danger" : undefined} />
        <Stat label="Requests, 7 days" value={a.requests7d.toLocaleString("en-US")} />
        <Stat label="Active API keys" value={a.activeKeys.toLocaleString("en-US")} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Busiest endpoints, 7 days" />
          {a.endpoints.length === 0 ? (
            <p className="p-4 text-[13px] text-muted">No API traffic yet.</p>
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {a.endpoints.map((e) => (
                <li key={`${e.method} ${e.endpoint}`} className="flex items-center gap-3 px-4 py-2">
                  <Badge>{e.method}</Badge>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{e.endpoint}</code>
                  <span className="text-xs text-subtle tnum">{e.avgLatencyMs} ms</span>
                  <span className="w-16 text-right font-medium tnum">{e.requests.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Top API users, 7 days" />
          {a.topUsers.length === 0 ? (
            <p className="p-4 text-[13px] text-muted">No API traffic yet.</p>
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {a.topUsers.map((u) => (
                <li key={u.userId} className="flex items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate">{u.email}</span>
                  <span className="font-medium tnum">{u.requests.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

interface Health {
  checks: Array<{ service: string; ok: boolean; latencyMs: number; detail?: string }>;
  email: { configured: boolean; provider: string };
  billing: { provider: string; stripeConfigured: boolean };
  scanner: string;
  maintenance: boolean;
  workerEnabled: boolean;
  lastBackupAt: string | null;
  backupsEnabled: boolean;
}

export function AdminHealth() {
  const res = useResource<Health>("admin-health", (signal) => api<Health>("/api/v1/admin/health", { signal }));
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Loading />;
  const h = res.data;
  const rows: Array<[string, string, "success" | "warning" | "neutral"]> = [
    ["Background worker", h.workerEnabled ? "Running in this process" : "Disabled (run a separate worker)", h.workerEnabled ? "success" : "warning"],
    ["Email delivery", h.email.configured ? `Provider: ${h.email.provider}` : "Not configured. Messages are recorded but not sent", h.email.configured ? "success" : "warning"],
    ["Billing", h.billing.provider === "stripe" ? (h.billing.stripeConfigured ? "Stripe (configured)" : "Stripe selected but keys are missing") : "Off. Plans are assigned by administrators", h.billing.provider === "stripe" && !h.billing.stripeConfigured ? "warning" : "neutral"],
    ["Malware scanner", h.scanner === "none" ? "Off. Only file-type rules apply" : h.scanner, h.scanner === "none" ? "warning" : "success"],
    ["Maintenance mode", h.maintenance ? "On" : "Off", h.maintenance ? "warning" : "neutral"],
    ["Database backups", h.backupsEnabled ? (h.lastBackupAt ? `Last successful backup ${timeAgo(h.lastBackupAt)}` : "Enabled, none taken yet") : "Disabled", h.backupsEnabled ? "success" : "warning"],
  ];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Live checks" description="Run when this page loads. The public status page is built from the same checks, run on a schedule." />
        <ul className="divide-y divide-line">
          {h.checks.map((c) => (
            <li key={c.service} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
              <Badge tone={c.ok ? "success" : "danger"}>{c.ok ? "OK" : "Failing"}</Badge>
              <span className="font-medium capitalize">{c.service}</span>
              <span className="text-xs text-subtle tnum">{c.latencyMs} ms</span>
              {c.detail && <span className="text-xs text-danger">{c.detail}</span>}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Configuration" />
        <dl className="divide-y divide-line text-[13px]">
          {rows.map(([k, v, tone]) => (
            <div key={k} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <dt className="w-44 text-subtle">{k}</dt>
              <dd className="flex-1">
                <Badge tone={tone}>{v}</Badge>
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

interface Backup {
  id: string;
  status: string;
  size: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  file: string | null;
}

export function AdminBackups() {
  const toast = useToast();
  const res = useResource<{ items: Backup[] }>("admin-backups", (signal) => api<{ items: Backup[] }>("/api/v1/admin/backups", { signal }));
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ items: Backup[] }>("/api/v1/admin/backups", { method: "POST" });
      res.mutate(r);
      toast.success("Backup created");
    } catch (err) {
      toast.error("Backup failed", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Loading />;
  return (
    <div>
      <ErrorNotice tone="info" className="mb-4">
        Backups contain the database only (accounts, file records, settings). File contents live in your storage provider and must be backed up there separately. Copies are kept in the data directory under <code className="font-mono">backups/</code>.
      </ErrorNotice>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={create} loading={busy} icon={<DatabaseBackup className="size-4" aria-hidden />}>
          Back up now
        </Button>
      </div>
      {res.data.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<DatabaseBackup />} title="No backups yet" description="Automatic backups run on the schedule in System settings, or create one now." />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {res.data.items.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
              <Badge tone={b.status === "ok" ? "success" : b.status === "failed" ? "danger" : "neutral"}>{b.status}</Badge>
              <span className="font-mono text-xs">{b.file ?? "—"}</span>
              {b.size != null && <span className="text-muted tnum">{formatBytes(b.size)}</span>}
              {b.error && <span className="text-xs text-danger">{b.error}</span>}
              <time className="ml-auto text-xs text-subtle" dateTime={b.createdAt}>
                {formatDateTime(b.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

interface EmailRow {
  id: string;
  to: string;
  template: string;
  subject: string;
  status: string;
  provider: string;
  error: string | null;
  createdAt: string;
}

export function AdminEmail() {
  const res = useResource<EmailRow[]>("admin-email", (signal) => api<EmailRow[] | { items: EmailRow[] }>("/api/v1/admin/email", { signal }).then((r) => (Array.isArray(r) ? r : r.items)));
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Loading />;
  return (
    <div>
      <ErrorNotice tone="info" className="mb-4">
        Every message the platform wants to send is recorded here first. With no email provider configured they&apos;re marked “skipped”: nothing is sent, so password-reset and invitation links are handed out by administrators instead.
      </ErrorNotice>
      {res.data.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<Mail />} title="Outbox is empty" />
        </div>
      ) : (
        <div role="region" aria-label="Email outbox" tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-subtle">
                <th className="px-4 py-2 font-medium">To</th>
                <th className="px-3 py-2 font-medium">Subject</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {res.data.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2">{m.to}</td>
                  <td className="max-w-sm truncate px-3 py-2" title={m.subject}>
                    {m.subject}
                    <span className="ml-2 text-xs text-subtle">{m.template}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={m.status === "sent" ? "success" : m.status === "failed" ? "danger" : "neutral"}>{m.status}</Badge>
                    {m.error && <span className="ml-2 text-xs text-danger">{m.error}</span>}
                  </td>
                  <td className="px-3 py-2 text-muted" title={formatDateTime(m.createdAt)}>
                    {timeAgo(m.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

interface Flag {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

export function AdminFlags() {
  const toast = useToast();
  const res = useResource<Flag[]>("admin-flags", (signal) => api<Flag[] | { items: Flag[] }>("/api/v1/admin/flags", { signal }).then((r) => (Array.isArray(r) ? r : r.items)));
  const set = async (f: Flag, enabled: boolean) => {
    try {
      const r = await api<{ items: Flag[] }>(`/api/v1/admin/flags/${f.key}`, { method: "PUT", body: { enabled } });
      res.mutate(r.items);
      toast.success(`${f.label} ${enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      toast.error("Couldn't change the flag", errorMessage(err));
    }
  };
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Loading />;
  return (
    <div>
      <p className="mb-3 text-[13px] text-muted">Feature flags switch whole capabilities off for everyone, regardless of plan. They take effect immediately and are enforced by the server.</p>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {res.data.map((f) => (
          <li key={f.key} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{f.label}</p>
              <p className="text-xs text-muted">{f.description}</p>
            </div>
            <input type="checkbox" role="switch" aria-label={f.label} checked={f.enabled} onChange={(e) => set(f, e.target.checked)} className="size-4 cursor-pointer accent-[var(--color-accent)]" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

interface AdminWebhook {
  id: string;
  name: string;
  host: string;
  ownerEmail: string;
  orgId: string | null;
  enabled: boolean;
  failureCount: number;
  lastDeliveryAt: string | null;
  createdAt: string;
}

export function AdminWebhooks() {
  const toast = useToast();
  const res = useResource<AdminWebhook[]>("admin-webhooks", (signal) => api<AdminWebhook[] | { items: AdminWebhook[] }>("/api/v1/admin/webhooks", { signal }).then((r) => (Array.isArray(r) ? r : r.items)));
  const set = async (w: AdminWebhook, enabled: boolean) => {
    try {
      await api(`/api/v1/admin/webhooks/${w.id}`, { method: "PATCH", body: { enabled } });
      toast.success(enabled ? "Webhook enabled" : "Webhook disabled");
      res.reload();
    } catch (err) {
      toast.error("Couldn't update the webhook", errorMessage(err));
    }
  };
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Loading />;
  return (
    <div>
      <p className="mb-3 text-[13px] text-muted">Every webhook endpoint on the platform, most failures first. Payloads and secrets are never shown here.</p>
      {res.data.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-[13px] text-muted">No webhooks have been created.</div>
      ) : (
        <div role="region" aria-label="Webhooks" tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-subtle">
                <th className="px-4 py-2 font-medium">Webhook</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Health</th>
                <th className="px-3 py-2 font-medium">Last delivery</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {res.data.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium">{w.name}</p>
                    <p className="font-mono text-xs text-muted">{w.host}</p>
                  </td>
                  <td className="px-3 py-2 text-muted">{w.ownerEmail}</td>
                  <td className="px-3 py-2">
                    <Badge tone={!w.enabled ? "warning" : w.failureCount > 0 ? "danger" : "success"}>{!w.enabled ? "Disabled" : w.failureCount > 0 ? `${w.failureCount} failures` : "Healthy"}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted">{w.lastDeliveryAt ? timeAgo(w.lastDeliveryAt) : "never"}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" onClick={() => set(w, !w.enabled)}>
                      {w.enabled ? "Disable" : "Enable"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
