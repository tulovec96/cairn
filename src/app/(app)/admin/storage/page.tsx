import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer } from "@/components/layout/AppShell";
import { RetryJobsButton } from "@/components/admin/StorageAdmin";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/Feedback";
import { CATEGORY_LABELS, type FileCategory } from "@/lib/fileTypes";
import { formatBytes, formatDateTime } from "@/lib/format";
import { storageOverview } from "@/server/services/admin";

export const metadata: Metadata = { title: "Storage · Administration" };

export default async function AdminStoragePage() {
  const s = await storageOverview();
  const total = s.byCategory.reduce((n, c) => n + c.bytes, 0);
  return (
    <PageContainer wide>
      <PageHeader title="Storage" description="Where the space goes, and the health of the storage layer and background jobs." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Storage health" actions={<Badge tone={s.health.ok ? "success" : "danger"}>{s.health.ok ? "Healthy" : "Problem"}</Badge>} />
          <dl className="divide-y divide-line text-[13px]">
            {[
              ["Provider", s.health.provider],
              ["Volume size", s.health.totalBytes !== null ? formatBytes(s.health.totalBytes) : "—"],
              ["Free space", s.health.freeBytes !== null ? formatBytes(s.health.freeBytes) : "—"],
              ["Stored in total", formatBytes(total)],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[9rem_1fr] gap-3 px-4 py-2">
                <dt className="text-subtle">{k}</dt>
                <dd className="tnum">{v}</dd>
              </div>
            ))}
          </dl>
          {s.health.detail && <p className="border-t border-line px-4 py-2 text-[13px] text-danger">{s.health.detail}</p>}
        </Card>

        <Card>
          <CardHeader title="By file type" />
          <ul className="divide-y divide-line text-[13px]">
            {s.byCategory.length === 0 && <li className="px-4 py-6 text-center text-muted">No files yet.</li>}
            {s.byCategory.map((c) => (
              <li key={c.category} className="px-4 py-2">
                <div className="flex items-baseline justify-between">
                  <span>{CATEGORY_LABELS[c.category as FileCategory] ?? c.category}</span>
                  <span className="text-muted tnum">
                    {formatBytes(c.bytes)} · {c.files.toLocaleString("en-US")} files
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${total ? (c.bytes / total) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Largest accounts" />
          {s.topUsers.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">No accounts with files yet.</p>
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {s.topUsers.map((u) => (
                <li key={u.userId} className="flex items-center justify-between gap-3 px-4 py-2">
                  <Link href={`/admin/users/${u.userId}`} className="min-w-0 truncate hover:underline">
                    {u.email}
                  </Link>
                  <span className="shrink-0 text-muted tnum">
                    {formatBytes(u.bytes)} · {u.files.toLocaleString("en-US")} files
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Background jobs" description="Failed jobs are retried automatically with backoff; these exhausted their attempts." actions={<RetryJobsButton failed={s.failedJobs.length} />} />
          {s.failedJobs.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">No failed jobs.</p>
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {s.failedJobs.map((j) => (
                <li key={j.id} className="px-4 py-2">
                  <p className="flex items-center justify-between gap-2">
                    <code className="font-mono text-xs">{j.type}</code>
                    <span className="text-xs text-muted">{j.finishedAt ? formatDateTime(j.finishedAt) : ""}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-danger" title={j.lastError ?? undefined}>
                    {j.lastError ?? "Unknown error"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
