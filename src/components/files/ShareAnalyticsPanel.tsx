"use client";

import { BarChart } from "@/components/charts/Charts";
import { UpgradeNotice } from "@/components/common/Upgrade";
import { useHasFeature } from "@/components/layout/AccountContext";
import { ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { api } from "@/lib/api-client";
import { formatBytes, formatDate, timeAgo } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { shareAnalytics } from "@/server/services/shares";

type Analytics = Awaited<ReturnType<typeof shareAnalytics>>;

/** Views and downloads for one link. Visitors are never identified: only counts, days and the referring site are kept. */
export function ShareAnalyticsPanel({ shareId }: { shareId: string }) {
  const allowed = useHasFeature("shareAnalytics");
  const res = useResource<Analytics | null>(`share-analytics:${shareId}:${allowed}`, (signal) => (allowed ? api<Analytics>(`/api/v1/shares/${shareId}/analytics?days=30`, { signal }) : Promise.resolve(null)));
  if (!allowed) return <UpgradeNotice feature="shareAnalytics" />;
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Skeleton className="h-64" />;
  const a = res.data;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg border border-line p-3">
          <p className="text-2xl font-semibold tnum">{a.totals.views.toLocaleString("en-US")}</p>
          <p className="text-xs text-subtle">views</p>
        </div>
        <div className="rounded-lg border border-line p-3">
          <p className="text-2xl font-semibold tnum">{a.totals.downloads.toLocaleString("en-US")}</p>
          <p className="text-xs text-subtle">downloads</p>
        </div>
        <div className="rounded-lg border border-line p-3">
          <p className="text-2xl font-semibold tnum">{formatBytes(a.totals.transferBytes)}</p>
          <p className="text-xs text-subtle">transferred, 30 d</p>
        </div>
      </div>
      <p className="text-xs text-subtle">{a.totals.lastAccessedAt ? `Last opened ${timeAgo(a.totals.lastAccessedAt)}.` : "Nobody has opened this link yet."}</p>
      {a.daily.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold">Last 30 days</h3>
          <BarChart points={a.daily.map((d) => ({ label: formatDate(`${d.day}T00:00:00Z`, "UTC"), value: d.views, alt: d.downloads }))} format={(v) => v.toLocaleString("en-US")} label="Views and downloads per day" series="events" />
          <p className="mt-1 text-xs text-subtle">Blue: views · amber: downloads</p>
        </div>
      ) : (
        <p className="text-[13px] text-muted">No activity in the last 30 days.</p>
      )}
      {a.referrers.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[13px] font-semibold">Where visitors came from</h3>
          <ul className="divide-y divide-line rounded-md border border-line text-[13px]">
            {a.referrers.map((r) => (
              <li key={r.host} className="flex items-center gap-3 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">{r.host}</span>
                <span className="font-medium tnum">{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-subtle">No IP addresses, cookies or trackers are involved: these are simple counters.</p>
    </div>
  );
}
