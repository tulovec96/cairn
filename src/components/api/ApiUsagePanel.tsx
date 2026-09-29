"use client";

import { BarChart } from "@/components/charts/Charts";
import { Card, CardHeader, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { api } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { apiUsageSummary } from "@/server/services/apikeys";

type Usage = Awaited<ReturnType<typeof apiUsageSummary>>;

/** Requests recorded by the API layer for this account's keys over the last two weeks. */
export function ApiUsagePanel() {
  const res = useResource<Usage>("api-usage", (signal) => api<Usage>("/api/v1/keys/usage", { signal }));
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Skeleton className="h-64" />;
  const u = res.data;
  return (
    <Card>
      <CardHeader title="Usage, last 14 days" description="Requests made with your API keys." />
      {u.total === 0 ? (
        <p className="p-4 text-[13px] text-muted">No API requests yet. Once a key is used, its traffic shows up here.</p>
      ) : (
        <div className="space-y-5 p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-semibold tnum">{u.total.toLocaleString("en-US")}</p>
              <p className="text-xs text-subtle">requests</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tnum">{u.errors.toLocaleString("en-US")}</p>
              <p className="text-xs text-subtle">errors (4xx/5xx)</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tnum">{((1 - u.errors / u.total) * 100).toFixed(1)}%</p>
              <p className="text-xs text-subtle">succeeded</p>
            </div>
          </div>
          <BarChart points={u.daily.map((d) => ({ label: formatDate(`${d.day}T00:00:00Z`, "UTC"), value: d.requests, alt: d.errors }))} format={(v) => v.toLocaleString("en-US")} label="API requests per day" series="requests" />
          <p className="-mt-3 text-xs text-subtle">Blue: requests · amber: errors</p>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-1.5 text-[13px] font-semibold">Busiest endpoints</h3>
              <ul className="divide-y divide-line rounded-md border border-line text-[13px]">
                {u.endpoints.map((e) => (
                  <li key={e.endpoint} className="flex items-center gap-3 px-3 py-1.5">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs">{e.endpoint}</code>
                    <span className="text-xs text-subtle tnum">{e.avgLatencyMs} ms</span>
                    <span className="w-14 text-right font-medium tnum">{e.requests.toLocaleString("en-US")}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1.5 text-[13px] font-semibold">By key</h3>
              {u.keys.length === 0 ? (
                <p className="text-[13px] text-muted">Requests weren&apos;t made with an API key.</p>
              ) : (
                <ul className="divide-y divide-line rounded-md border border-line text-[13px]">
                  {u.keys.map((k) => (
                    <li key={k.id} className="flex items-center gap-3 px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate">
                        {k.name} <span className="font-mono text-xs text-subtle">{k.prefix}…</span>
                      </span>
                      <span className="font-medium tnum">{k.requests.toLocaleString("en-US")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
