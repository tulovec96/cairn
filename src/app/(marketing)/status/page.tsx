import type { Metadata } from "next";
import { MarketingHero } from "@/components/marketing/MarketingShell";
import { Badge } from "@/components/ui/Feedback";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { publicStatus, type StatusDto } from "@/server/services/content";

export const metadata: Metadata = { title: "Status" };
export const dynamic = "force-dynamic";

const BANNER: Record<StatusDto["overall"], { text: string; cls: string }> = {
  operational: { text: "All systems operational", cls: "border-success/40 bg-success-soft text-success" },
  degraded: { text: "Some systems are degraded", cls: "border-warning/40 bg-warning-soft text-warning" },
  outage: { text: "There is an outage", cls: "border-danger/40 bg-danger-soft text-danger" },
  unknown: { text: "No recent health checks", cls: "border-line-strong bg-surface-2 text-muted" },
};

function lastDays(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now - i * 86400_000).toISOString().slice(0, 10));
  return out;
}

export default async function StatusPage() {
  const status = await publicStatus();
  const banner = BANNER[status.overall];
  const days = lastDays(90);
  return (
    <>
      <MarketingHero eyebrow="Status" title="Is it working right now?" lead="Built from real health checks that run on a schedule against the database, storage, job queue and scanner, plus any incident an administrator has posted. If there are no recent checks, it says so instead of guessing." />
      <section>
        <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
          <div role="status" className={cn("rounded-xl border px-5 py-4 text-[15px] font-semibold", banner.cls)}>
            {banner.text}
          </div>

          {status.incidents.length > 0 && (
            <div className="mt-8">
              <h2 className="mk-display text-xl">Ongoing incidents</h2>
              <ul className="mt-3 space-y-3">
                {status.incidents.map((i) => (
                  <li key={i.id} className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={i.severity === "critical" ? "danger" : "warning"}>{i.severity}</Badge>
                      <Badge>{i.status}</Badge>
                      <span className="text-xs text-subtle">{formatDateTime(i.createdAt, "UTC")} UTC</span>
                    </div>
                    <h3 className="mt-2 text-[15px] font-semibold">{i.title}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-line text-muted">{i.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h2 className="mk-display mt-10 text-xl">Services</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {status.services.map((s) => {
              const byDay = new Map(s.days.map((d) => [d.day, d]));
              return (
                <li key={s.key} className="p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-[14px] font-semibold">{s.name}</h3>
                    {s.ok === null ? <Badge>No recent check</Badge> : s.ok ? <Badge tone="success">Operational</Badge> : <Badge tone="danger">Failing</Badge>}
                    <span className="ml-auto text-xs text-subtle tnum">
                      {s.uptime90 !== null ? `${s.uptime90}% over 90 days` : "no data yet"}
                      {s.latencyMs !== null && ` · ${s.latencyMs} ms`}
                      {s.checkedAt && ` · checked ${timeAgo(s.checkedAt)}`}
                    </span>
                  </div>
                  <div className="mt-3 flex h-7 gap-[2px]" role="img" aria-label={`${s.name}: daily health over the last 90 days`}>
                    {days.map((d) => {
                      const v = byDay.get(d);
                      const cls = !v ? "bg-surface-3" : v.failed === 0 ? "bg-success" : v.ok === 0 ? "bg-danger" : "bg-warning";
                      return <span key={d} title={`${formatDate(`${d}T00:00:00Z`, "UTC")}: ${v ? `${v.ok} ok, ${v.failed} failed` : "no data"}`} className={cn("flex-1 rounded-[2px]", cls)} />;
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-subtle">Grey days have no recorded checks. Green: every check passed. Amber: some failed. Red: all failed.</p>

          <h2 className="mk-display mt-10 text-xl">Past 30 days</h2>
          {status.recent.length === 0 ? (
            <p className="mt-3 text-[14px] text-muted">No incidents were posted.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {status.recent.map((i) => (
                <li key={i.id} className="rounded-lg border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
                    <Badge tone="success">resolved</Badge>
                    <span>{formatDate(i.createdAt, "UTC")}</span>
                  </div>
                  <h3 className="mt-1.5 text-[14px] font-semibold">{i.title}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-line text-muted">{i.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
