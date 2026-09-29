"use client";

import Link from "next/link";
import { useState } from "react";
import { AreaChart, BarChart, Meter } from "@/components/charts/Charts";
import { UpgradeNotice } from "@/components/common/Upgrade";
import { Card, CardHeader, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { api } from "@/lib/api-client";
import { CATEGORY_LABELS, type FileCategory } from "@/lib/fileTypes";
import { formatBytes, formatDate, pluralize, timeAgo } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { storageAnalytics, transferAnalytics } from "@/server/services/analytics";

type Storage = Awaited<ReturnType<typeof storageAnalytics>>;
type Transfer = Awaited<ReturnType<typeof transferAnalytics>>;

const shortDay = (d: string) => formatDate(`${d}T00:00:00Z`, "UTC");

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tnum">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function StorageTab() {
  const res = useResource<Storage>("analytics-storage", (signal) => api<Storage>("/api/v1/analytics/storage", { signal }));
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Skeleton className="h-96" />;
  const s = res.data;
  const unlimited = s.quotaBytes < 0;
  const pct = unlimited ? 0 : (s.usedBytes / s.quotaBytes) * 100;
  const totalCat = s.byCategory.reduce((n, c) => n + c.bytes, 0) || 1;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Used" value={formatBytes(s.usedBytes)} sub={unlimited ? "Unlimited plan" : `of ${formatBytes(s.quotaBytes, 0)} (${pct.toFixed(pct < 10 ? 1 : 0)}%)`} />
        <Stat label="Current files" value={formatBytes(s.filesBytes)} />
        <Stat label="Older versions" value={formatBytes(s.versionsBytes)} sub={pluralize(s.versionCount, "version")} />
        <Stat label="In the trash" value={formatBytes(s.trashBytes)} sub={pluralize(s.trashCount, "item")} />
      </div>
      {!unlimited && <Meter value={s.usedBytes} max={s.quotaBytes} tone={pct >= 95 ? "danger" : pct >= 80 ? "warning" : "accent"} label="Storage used" />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="What's taking the space" />
          {s.byCategory.length === 0 ? (
            <p className="p-4 text-[13px] text-muted">No files yet.</p>
          ) : (
            <ul className="space-y-3 p-4">
              {s.byCategory.map((c) => (
                <li key={c.category}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <span>{CATEGORY_LABELS[c.category as FileCategory] ?? c.category}</span>
                    <span className="text-muted tnum">
                      {formatBytes(c.bytes)} · {pluralize(c.files, "file")}
                    </span>
                  </div>
                  <Meter value={c.bytes} max={totalCat} label={`${c.category} share of storage`} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Growth, last 90 days" />
          <div className="p-4">
            {s.advanced ? <AreaChart points={s.growth.map((g) => ({ label: shortDay(g.day), value: g.bytes }))} format={(v) => formatBytes(v)} label="Storage used over 90 days" /> : <UpgradeNotice feature="advancedAnalytics" compact />}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Largest files" />
          {s.largest.length === 0 ? (
            <p className="p-4 text-[13px] text-muted">No files yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.largest.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                  <Link href={`/file/${f.id}`} className="min-w-0 flex-1 truncate hover:text-accent hover:underline">
                    {f.name}
                  </Link>
                  <span className="font-medium tnum">{formatBytes(f.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Untouched for months" description="Older than 90 days and not opened in 180 days." />
          {s.stale.length === 0 ? (
            <p className="p-4 text-[13px] text-muted">Nothing has gone stale.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.stale.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                  <Link href={`/file/${f.id}`} className="min-w-0 flex-1 truncate hover:text-accent hover:underline">
                    {f.name}
                  </Link>
                  <span className="text-xs text-subtle">{f.lastAccessedAt ? `opened ${timeAgo(f.lastAccessedAt)}` : "never opened"}</span>
                  <span className="font-medium tnum">{formatBytes(f.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {s.duplicates && s.duplicates.groups > 0 && (
        <p className="text-[13px] text-muted">
          <Link href="/duplicates" className="font-medium text-accent hover:underline">
            {pluralize(s.duplicates.groups, "group")} of duplicate files
          </Link>{" "}
          could free up {formatBytes(s.duplicates.reclaimableBytes)}.
        </p>
      )}
    </div>
  );
}

function TransferTab() {
  const [days, setDays] = useState(30);
  const res = useResource<Transfer>(`analytics-transfer:${days}`, (signal) => api<Transfer>(`/api/v1/analytics/transfer?days=${days}`, { signal }));
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Skeleton className="h-96" />;
  const t = res.data;
  const allowance = t.transferAllowanceBytes;
  const totalDownloads = t.daily.reduce((n, d) => n + d.downloads, 0);
  const totalUploads = t.daily.reduce((n, d) => n + d.uploads, 0);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted">Period</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]">
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Downloaded this month" value={formatBytes(t.thisMonth.downloadBytes)} sub={allowance < 0 ? "No monthly limit" : `of ${formatBytes(allowance, 0)}`} />
        <Stat label="Uploaded this month" value={formatBytes(t.thisMonth.uploadBytes)} />
        <Stat label={`Downloads, ${days} days`} value={totalDownloads.toLocaleString("en-US")} sub={`${t.viaShares.toLocaleString("en-US")} through share links`} />
        <Stat label={`Uploads, ${days} days`} value={totalUploads.toLocaleString("en-US")} />
      </div>
      {allowance >= 0 && <Meter value={t.thisMonth.downloadBytes} max={allowance} tone={t.thisMonth.downloadBytes / allowance >= 0.9 ? "danger" : t.thisMonth.downloadBytes / allowance >= 0.75 ? "warning" : "accent"} label="Monthly transfer used" />}
      <Card>
        <CardHeader title="Downloads and uploads per day" description="Blue: downloads · amber: uploads" />
        <div className="p-4">
          <BarChart points={t.daily.map((d) => ({ label: shortDay(d.day), value: d.downloads, alt: d.uploads }))} format={(v) => v.toLocaleString("en-US")} label="Downloads and uploads per day" series="events" />
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Most downloaded files" />
          {t.advanced ? (
            t.topFiles.length === 0 ? (
              <p className="p-4 text-[13px] text-muted">No downloads yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {t.topFiles.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                    <Link href={`/file/${f.id}`} className="min-w-0 flex-1 truncate hover:text-accent hover:underline">
                      {f.name}
                    </Link>
                    <span className="font-medium tnum">{pluralize(f.downloads, "download")}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="p-4">
              <UpgradeNotice feature="advancedAnalytics" compact />
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Monthly download volume" />
          {t.advanced ? (
            t.monthlyDownloadBytes.length === 0 ? (
              <p className="p-4 text-[13px] text-muted">No history yet.</p>
            ) : (
              <div className="p-4">
                <BarChart points={t.monthlyDownloadBytes.map((m) => ({ label: m.period, value: m.value }))} format={(v) => formatBytes(v)} label="Download volume per month" series="of transfer" />
              </div>
            )
          ) : (
            <div className="p-4">
              <UpgradeNotice feature="advancedAnalytics" compact />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export function AnalyticsDashboard() {
  const [tab, setTab] = useState<"storage" | "transfer">("storage");
  return (
    <Tabs
      label="Analytics"
      value={tab}
      onChange={setTab}
      tabs={[
        { value: "storage", label: "Storage" },
        { value: "transfer", label: "Transfer" },
      ]}
    >
      {tab === "storage" ? <StorageTab /> : <TransferTab />}
    </Tabs>
  );
}
