"use client";

import { BarChart3, Clock, ExternalLink, Eye, FileText, Folder, Link2, Lock, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Modal";
import { ShareAnalyticsPanel } from "./ShareAnalyticsPanel";
import { CopyButton } from "@/components/ui/CopyButton";
import { useConfirm } from "@/components/ui/Confirm";
import { Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage, shareLink } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";
import { cn } from "@/lib/cn";
import { formatDate, timeAgo, timeUntil } from "@/lib/format";
import type { ShareDto } from "@/lib/types";
import { ShareDialog, type ShareTarget } from "./ShareDialog";

const FILTERS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Expired & revoked" },
  { value: "all", label: "All" },
] as const;

export function SharesManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const res = useResource("shares", (signal) => api<{ items: ShareDto[] }>("/api/v1/shares", { signal }));
  const items = res.data?.items ?? null;
  const error = res.error;
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("active");
  const [manage, setManage] = useState<ShareTarget | null>(null);
  const [stats, setStats] = useState<ShareDto | null>(null);

  const load = () => res.reload();

  const visible = (items ?? []).filter((s) => (filter === "all" ? true : filter === "active" ? s.state === "active" : s.state !== "active"));

  const revoke = async (s: ShareDto) => {
    if (!(await confirm({ title: "Revoke this link?", description: `Anyone with the link to “${s.targetName}” loses access immediately.`, confirmLabel: "Revoke", tone: "danger" }))) return;
    try {
      await api(`/api/v1/shares/${s.id}`, { method: "PATCH", body: { revoked: true } });
      toast.success("Link revoked");
      void load();
    } catch (err) {
      toast.error("Couldn't revoke the link", errorMessage(err));
    }
  };

  const remove = async (s: ShareDto) => {
    try {
      await api(`/api/v1/shares/${s.id}`, { method: "DELETE" });
      toast.success("Link deleted");
      void load();
    } catch (err) {
      toast.error("Couldn't delete the link", errorMessage(err));
    }
  };

  return (
    <div>
      <div role="tablist" aria-label="Filter links" className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5">
        {FILTERS.map((f) => (
          <button key={f.value} role="tab" type="button" aria-selected={filter === f.value} onClick={() => setFilter(f.value)} className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium", filter === f.value ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}>
            {f.label}
            {items && <span className="ml-1.5 text-xs opacity-70 tnum">{items.filter((s) => (f.value === "all" ? true : f.value === "active" ? s.state === "active" : s.state !== "active")).length}</span>}
          </button>
        ))}
      </div>

      {error && <ErrorNotice className="mb-3">{error}</ErrorNotice>}

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {!items ? (
          <div className="divide-y divide-line">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-8" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Link2 />}
            title={filter === "active" ? "No active links" : "Nothing here"}
            description={filter === "active" ? "Open a file's menu and choose Share to create a link. Links can have passwords, expiry dates and download limits." : "Expired and revoked links show up here."}
            action={
              <Link href="/files" className="text-[13px] font-medium text-accent hover:underline">
                Go to your files
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((s) => {
              const target: ShareTarget = { kind: s.fileId ? "file" : "folder", id: (s.fileId ?? s.folderId)!, name: s.targetName ?? "Item" };
              const inactive = s.state !== "active";
              return (
                <li key={s.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3", inactive && "opacity-70")}>
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", s.fileId ? "bg-surface-3 text-muted" : "bg-warning-soft text-warning")}>
                    {s.fileId ? <FileText className="size-4" aria-hidden /> : <Folder className="size-4" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-[13px] font-medium" title={s.targetName ?? undefined}>
                      {s.targetName}
                    </p>
                    <p className="truncate font-mono text-xs text-muted">/d/{s.token}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {s.state === "active" ? <Badge tone="success">Active</Badge> : s.state === "revoked" ? <Badge tone="danger">Revoked</Badge> : s.state === "expired" ? <Badge tone="warning">Expired</Badge> : <Badge tone="warning">Limit reached</Badge>}
                    {s.hasPassword && <Badge icon={<Lock className="size-3" aria-hidden />}>Password</Badge>}
                    <span className="inline-flex items-center gap-1 text-muted">
                      <Clock className="size-3" aria-hidden /> {s.expiresAt ? timeUntil(s.expiresAt) : "No expiry"}
                    </span>
                    {!s.permissions.includes("download") && <Badge icon={<Eye className="size-3" aria-hidden />}>View only</Badge>}
                    {s.ipAllowlist.length > 0 && <Badge icon={<ShieldCheck className="size-3" aria-hidden />}>IP restricted</Badge>}
                    <span className="text-muted tnum">
                      {s.viewCount}
                      {s.maxViews ? `/${s.maxViews}` : ""} views · {s.downloadCount}
                      {s.maxDownloads ? `/${s.maxDownloads}` : ""} downloads
                    </span>
                    <span className="text-subtle" title={formatDate(s.createdAt)}>
                      created {timeAgo(s.createdAt)}
                    </span>
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    {!inactive && <CopyButton value={() => shareLink(s.token)} iconOnly label={`Copy link for ${s.targetName}`} />}
                    {!inactive && (
                      <Link href={`/d/${s.token}`} target="_blank" aria-label={`Open link for ${s.targetName}`} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
                        <ExternalLink className="size-4" aria-hidden />
                      </Link>
                    )}
                    <Button size="icon-sm" variant="ghost" aria-label={`Analytics for ${s.targetName}`} onClick={() => setStats(s)}>
                      <BarChart3 className="size-4" aria-hidden />
                    </Button>
                    {!inactive && (
                      <Button size="icon-sm" variant="ghost" aria-label={`Link settings for ${s.targetName}`} onClick={() => setManage(target)}>
                        <Settings2 className="size-4" aria-hidden />
                      </Button>
                    )}
                    {!inactive ? (
                      <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => revoke(s)}>
                        Revoke
                      </Button>
                    ) : (
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete record for ${s.targetName}`} onClick={() => remove(s)}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {manage && <ShareDialog target={manage} onClose={() => setManage(null)} onChanged={() => void load()} />}
      <Drawer open={!!stats} onOpenChange={(o) => !o && setStats(null)} title={stats ? `Analytics: ${stats.targetName ?? "link"}` : "Analytics"} width="w-full sm:w-[30rem]">
        {stats && (
          <div className="p-4">
            <ShareAnalyticsPanel shareId={stats.id} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
