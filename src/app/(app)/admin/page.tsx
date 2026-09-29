import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Clock, Download, FileText, HardDrive, Link2, ShieldAlert, Users, UploadCloud, Cpu } from "lucide-react";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/Feedback";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { adminOverview } from "@/server/services/admin";

export const metadata: Metadata = { title: "Administration" };

function Tile({ icon, label, value, sub, href, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; href?: string; tone?: "warning" | "danger" }) {
  const body = (
    <div className="flex items-start gap-3 p-4">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg [&>svg]:size-4", tone === "danger" ? "bg-danger-soft text-danger" : tone === "warning" ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted")}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-subtle">{label}</p>
        <p className="text-xl font-semibold tracking-tight tnum">{value}</p>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-lg border border-line bg-surface transition-colors hover:border-line-strong">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-line bg-surface">{body}</div>
  );
}

export default async function AdminOverviewPage() {
  const o = await adminOverview();
  const disk = o.storage;
  const usedPct = disk.totalBytes && disk.freeBytes !== null ? ((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100 : null;
  return (
    <PageContainer wide>
      <PageHeader title="Administration" description="Live figures from the database and storage. Nothing here is cached or estimated." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Users />} label="Users" value={o.users.toLocaleString("en-US")} sub={o.suspendedUsers ? `${o.suspendedUsers} suspended` : undefined} href="/admin/users" />
        <Tile icon={<Users />} label="Organizations" value={o.organizations.toLocaleString("en-US")} />
        <Tile icon={<FileText />} label="Files" value={o.files.toLocaleString("en-US")} href="/admin/files" />
        <Tile icon={<HardDrive />} label="Stored" value={formatBytes(o.storageBytes)} sub="including trash" href="/admin/storage" />
        <Tile icon={<Download />} label="Downloads" value={o.downloadsTotal.toLocaleString("en-US")} sub={`${o.downloads24h.toLocaleString("en-US")} in the last 24 h`} />
        <Tile icon={<Link2 />} label="Active shares" value={o.activeShares.toLocaleString("en-US")} />
        <Tile icon={<ShieldAlert />} label="Pending reports" value={o.pendingReports.toLocaleString("en-US")} href="/admin/reports" tone={o.pendingReports ? "warning" : undefined} />
        <Tile icon={<Clock />} label="Expiring in 24 h" value={o.expiringSoon.toLocaleString("en-US")} />
        <Tile icon={<UploadCloud />} label="Failed uploads (7 d)" value={o.failedUploads.toLocaleString("en-US")} tone={o.failedUploads ? "warning" : undefined} />
        <Tile icon={<AlertTriangle />} label="Quarantined files" value={o.quarantined.toLocaleString("en-US")} href="/admin/files?status=quarantined" tone={o.quarantined ? "danger" : undefined} />
        <Tile icon={<Cpu />} label="Background jobs" value={`${o.jobs.pending} pending`} sub={o.jobs.failed ? `${o.jobs.failed} failed` : "none failed"} href="/admin/storage" tone={o.jobs.failed ? "danger" : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Storage health" actions={<Badge tone={disk.ok ? "success" : "danger"}>{disk.ok ? "Healthy" : "Problem"}</Badge>} />
          <div className="space-y-3 p-4 text-[13px]">
            <p className="text-muted">
              Provider: <span className="font-medium text-fg">{disk.provider}</span>
            </p>
            {disk.detail && <p className="text-danger">{disk.detail}</p>}
            {disk.totalBytes !== null && disk.freeBytes !== null && (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Disk used" aria-valuenow={Math.round(usedPct ?? 0)} aria-valuemin={0} aria-valuemax={100}>
                  <div className={cn("h-full rounded-full", (usedPct ?? 0) > 90 ? "bg-danger" : (usedPct ?? 0) > 80 ? "bg-warning" : "bg-accent")} style={{ width: `${usedPct}%` }} />
                </div>
                <p className="text-muted tnum">
                  {formatBytes(disk.freeBytes)} free of {formatBytes(disk.totalBytes)} on the storage volume
                </p>
              </>
            )}
          </div>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="Daily snapshots" description="Recorded once a day by the statistics job." />
          {o.snapshots.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">The first snapshot is recorded shortly after the server starts.</p>
          ) : (
            <div role="region" aria-label="Overview table" tabIndex={0} className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-[13px]">
                <thead className="border-b border-line text-xs text-subtle">
                  <tr>
                    {["Day (UTC)", "Users", "Files", "Stored", "Uploads (24h)", "Downloads (24h)"].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tnum">
                  {[...o.snapshots].reverse().map((s) => (
                    <tr key={s.day}>
                      <td className="px-3 py-1.5">{s.day}</td>
                      <td className="px-3 py-1.5">{s.users}</td>
                      <td className="px-3 py-1.5">{s.files}</td>
                      <td className="px-3 py-1.5">{formatBytes(s.storageBytes)}</td>
                      <td className="px-3 py-1.5">{s.uploads}</td>
                      <td className="px-3 py-1.5">{s.downloads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
