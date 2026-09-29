import { ACTIVITY_LABELS } from "@/lib/activity";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Download, FileText, Folder, HardDrive, Link2, Trash2, UploadCloud } from "lucide-react";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/Feedback";
import { ButtonLink } from "@/components/ui/Button";
import { FileIcon } from "@/components/ui/FileIcon";
import { requirePageUser } from "@/server/page-auth";
import { dashboardFor } from "@/server/services/dashboard";
import { formatBytes, pluralize, timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Dashboard" };

const ACTIVITY = ACTIVITY_LABELS;

function Stat({ icon, label, value, href, sub }: { icon: React.ReactNode; label: string; value: string; href?: string; sub?: string }) {
  const body = (
    <div className="flex items-start gap-3 p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted [&>svg]:size-4">{icon}</span>
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

export default async function DashboardPage() {
  const actor = await requirePageUser();
  const d = await dashboardFor(actor);
  const pct = Math.round(d.usage.percent);
  const tone = pct >= 90 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-accent";
  return (
    <PageContainer wide>
      <div className="cairn-rise">
        <PageHeader
          title={`Hello, ${actor.user.displayName}`}
          description="Your storage and what's been happening."
          actions={
            <ButtonLink href="/upload" variant="primary" icon={<UploadCloud className="size-4" aria-hidden />}>
              Upload
            </ButtonLink>
          }
        />
      </div>



      <div className="cairn-rise" style={{ animationDelay: "120ms" }}>
      <Card className="mb-4">
        <div className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Storage</h2>
            <p className="text-[13px] text-muted tnum">
              {formatBytes(d.usage.usedBytes)} of {formatBytes(d.usage.quotaBytes)} · <strong className="font-medium text-fg">{formatBytes(Math.max(0, d.usage.quotaBytes - d.usage.usedBytes))} free</strong>
            </p>
          </div>
          <div role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-3">
            <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(pct > 0 ? 1 : 0, Math.min(100, d.usage.percent))}%` }} />
          </div>
          {pct >= 80 && (
            <p className={cn("mt-3 text-[13px]", pct >= 90 ? "text-danger" : "text-warning")}>
              {pct >= 100 ? "Your storage is full and new uploads are blocked. " : `You've used ${pct}% of your storage. `}
              <Link href="/files?sort=size&order=desc" className="font-medium underline underline-offset-2">
                Find large files
              </Link>
              {d.trash.items > 0 && (
                <>
                  {" · "}
                  <Link href="/trash" className="font-medium underline underline-offset-2">
                    Empty the trash ({formatBytes(d.trash.bytes)})
                  </Link>
                </>
              )}
            </p>
          )}
          <p className="mt-2 text-xs text-subtle">Maximum file size {formatBytes(d.usage.maxFileBytes, 0)}. Trashed files count until they are permanently removed.</p>
        </div>
      </Card>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<FileText />} label="Files" value={d.fileCount.toLocaleString("en-US")} href="/files" />
        <Stat icon={<Folder />} label="Folders" value={d.folderCount.toLocaleString("en-US")} href="/files" />
        <Stat icon={<Download />} label="Downloads" value={d.downloadCount.toLocaleString("en-US")} sub="across all your files" />
        <Stat icon={<Link2 />} label="Active links" value={d.activeShares.toLocaleString("en-US")} href="/shared" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href="/duplicates" className="group rounded-xl border border-line bg-surface p-4 transition-all hover:border-accent-line hover:shadow-[0_10px_24px_rgb(16_32_42/0.08)]"><p className="text-xs text-subtle">Library health</p><p className="mt-2 text-sm font-semibold">Find duplicates <ArrowUpRight className="ml-1 inline size-3.5 text-accent" aria-hidden /></p></Link>
        <Link href="/automations" className="group rounded-xl border border-line bg-surface p-4 transition-all hover:border-accent-line hover:shadow-[0_10px_24px_rgb(16_32_42/0.08)]"><p className="text-xs text-subtle">Save time</p><p className="mt-2 text-sm font-semibold">Automate tasks <ArrowUpRight className="ml-1 inline size-3.5 text-accent" aria-hidden /></p></Link>
        <Link href="/analytics" className="group rounded-xl border border-line bg-surface p-4 transition-all hover:border-accent-line hover:shadow-[0_10px_24px_rgb(16_32_42/0.08)]"><p className="text-xs text-subtle">Where the space goes</p><p className="mt-2 text-sm font-semibold">Storage analytics <ArrowUpRight className="ml-1 inline size-3.5 text-accent" aria-hidden /></p></Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Recent files" actions={<Link href="/recent" className="text-xs font-medium text-accent hover:underline">View all</Link>} />
          {d.recentFiles.length === 0 ? (
            <EmptyState icon={<UploadCloud />} title="No files yet" description="Upload your first file to see it here." action={<ButtonLink href="/upload" variant="primary">Upload files</ButtonLink>} />
          ) : (
            <ul className="divide-y divide-line">
              {d.recentFiles.map((f) => (
                <li key={f.id}>
                  <Link href={`/file/${f.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <FileIcon category={f.category} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{f.name}</p>
                      <p className="text-xs text-muted tnum">
                        {formatBytes(f.size)} · {timeAgo(f.createdAt)}
                      </p>
                    </div>
                    {f.share && <Badge tone="accent">Shared</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" />
          {d.activity.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-muted">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.activity.map((a) => (
                <li key={a.id} className="px-4 py-2.5 text-[13px]">
                  <p className="text-fg">
                    {ACTIVITY[a.action] ?? a.action}
                    {a.targetName && <span className="text-muted"> “{a.targetName}”</span>}
                  </p>
                  <p className="text-xs text-subtle">{timeAgo(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
          {d.trash.items > 0 && (
            <Link href="/trash" className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[13px] text-muted hover:bg-surface-2">
              <Trash2 className="size-4" aria-hidden /> {pluralize(d.trash.items, "item")} in trash · {formatBytes(d.trash.bytes)}
              <HardDrive className="ml-auto size-4 text-subtle" aria-hidden />
            </Link>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
