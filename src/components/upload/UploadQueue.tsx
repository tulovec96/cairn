"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Pause, Play, RotateCcw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { ProgressBar } from "@/components/ui/Feedback";
import { FileIcon } from "@/components/ui/FileIcon";
import { Tip } from "@/components/ui/Overlays";
import { cn } from "@/lib/cn";
import { categorize, extensionOf } from "@/lib/fileTypes";
import { formatBytes, formatDuration, formatSpeed } from "@/lib/format";
import { t } from "@/i18n";
import type { UploadItem, UploadStatus } from "@/lib/upload/engine";
import { InterruptedUploads } from "./InterruptedUploads";
import { useUploadManager, useUploads } from "./UploadProvider";

const STATUSES: UploadStatus[] = ["waiting", "uploading", "paused", "hashing", "quarantined", "finalizing", "processing", "scanning", "complete", "failed", "cancelled", "retrying"];
const LABELS = Object.fromEntries(STATUSES.map((s) => [s, t(`upload.status.${s}`)])) as Record<UploadStatus, string>;

function StatusText({ item }: { item: UploadItem }) {
  const base = "inline-flex items-center gap-1 text-xs font-medium";
  switch (item.status) {
    case "complete":
      return (
        <span className={cn(base, "text-success")}>
          <CheckCircle2 className="size-3.5" aria-hidden /> Complete
        </span>
      );
    case "failed":
      return (
        <span className={cn(base, "text-danger")}>
          <AlertTriangle className="size-3.5" aria-hidden /> Failed
        </span>
      );
    case "quarantined":
      return (
        <span className={cn(base, "text-danger")}>
          <ShieldAlert className="size-3.5" aria-hidden /> Quarantined
        </span>
      );
    case "cancelled":
      return <span className={cn(base, "text-subtle")}>Cancelled</span>;
    case "paused":
      return (
        <span className={cn(base, "text-warning")}>
          <Pause className="size-3.5" aria-hidden /> Paused
        </span>
      );
    case "retrying":
      return (
        <span className={cn(base, "text-warning")}>
          <RotateCcw className="size-3.5" aria-hidden /> Retrying{item.attempt > 1 ? ` (${item.attempt})` : ""}
        </span>
      );
    case "scanning":
      return (
        <span className={cn(base, "text-accent")}>
          <ShieldCheck className="size-3.5" aria-hidden /> Scanning
        </span>
      );
    case "hashing":
    case "processing":
    case "finalizing":
      return (
        <span className={cn(base, "text-accent")}>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> {LABELS[item.status]}
        </span>
      );
    default:
      return <span className={cn(base, "text-muted")}>{LABELS[item.status]}</span>;
  }
}

function Row({ item, compact }: { item: UploadItem; compact?: boolean }) {
  const manager = useUploadManager();
  const cat = categorize(item.mime, extensionOf(item.name));
  const active = ["uploading", "retrying"].includes(item.status);
  const busy = ["hashing", "finalizing", "processing", "scanning"].includes(item.status);
  const showBar = ["waiting", "uploading", "retrying", "paused", "hashing", "finalizing", "processing", "scanning"].includes(item.status);

  return (
    <li className="px-3.5 py-3">
      <div className="flex items-start gap-3">
        <FileIcon category={cat} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[13px] font-medium text-fg" title={item.name}>
              {item.name}
            </p>
            <StatusText item={item} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted tnum">
            {item.status === "complete" ? (
              <span>{formatBytes(item.size)}</span>
            ) : (
              <>
                <span>
                  {formatBytes(item.uploadedBytes)} of {formatBytes(item.size)}
                </span>
                {active && item.speed > 0 && <span>{formatSpeed(item.speed)}</span>}
                {active && item.eta !== null && <span>{formatDuration(item.eta)} left</span>}
                {item.resumed && item.status !== "failed" && <span className="text-accent">Resumed</span>}
              </>
            )}
          </p>
          {showBar && (
            <ProgressBar
              className="mt-2"
              label={`${item.name}: ${LABELS[item.status]}`}
              value={busy ? null : item.progress}
              tone={item.status === "paused" || item.status === "retrying" ? "warning" : "accent"}
            />
          )}
          {item.error && (item.status === "failed" || item.status === "retrying" || item.status === "quarantined") && (
            <p role={item.status === "retrying" ? undefined : "alert"} className={cn("mt-1.5 text-xs", item.status === "retrying" ? "text-warning" : "text-danger")}>
              {item.error}
            </p>
          )}
          {item.status === "complete" && item.shareUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                readOnly
                aria-label={`Link for ${item.name}`}
                value={typeof window !== "undefined" && item.result?.share ? `${window.location.origin}/d/${item.result.share.token}` : item.shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-2.5 font-mono text-xs text-fg"
              />
              <CopyButton
                value={() => (item.result?.share ? `${window.location.origin}/d/${item.result.share.token}` : item.shareUrl ?? "")}
                size="sm"
                variant="primary"
              />
              {item.result?.share && (
                <Link
                  href={`/d/${item.result.share.token}`}
                  target="_blank"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-line-strong px-2.5 text-[13px] font-medium text-fg hover:bg-surface-2"
                >
                  <ExternalLink className="size-3.5" aria-hidden /> Open
                </Link>
              )}
            </div>
          )}
          {item.status === "complete" && !item.shareUrl && <p className="mt-1 text-xs text-muted">Saved privately. Share it from your files whenever you like.</p>}
        </div>
        <div className={cn("flex shrink-0 items-center gap-0.5", compact && "-mr-1")}>
          {active && (
            <Tip label="Pause">
              <Button variant="ghost" size="icon-sm" aria-label={`Pause ${item.name}`} onClick={() => manager.pause(item.id)}>
                <Pause className="size-4" aria-hidden />
              </Button>
            </Tip>
          )}
          {item.status === "paused" && (
            <Tip label="Resume">
              <Button variant="ghost" size="icon-sm" aria-label={`Resume ${item.name}`} onClick={() => manager.resume(item.id)}>
                <Play className="size-4" aria-hidden />
              </Button>
            </Tip>
          )}
          {(item.status === "failed" || item.status === "cancelled") && (
            <Tip label="Retry">
              <Button variant="ghost" size="icon-sm" aria-label={`Retry ${item.name}`} onClick={() => manager.retry(item.id)}>
                <RotateCcw className="size-4" aria-hidden />
              </Button>
            </Tip>
          )}
          {["waiting", "uploading", "retrying", "paused"].includes(item.status) && (
            <Tip label="Cancel">
              <Button variant="ghost" size="icon-sm" aria-label={`Cancel ${item.name}`} onClick={() => void manager.cancel(item.id)}>
                <X className="size-4" aria-hidden />
              </Button>
            </Tip>
          )}
          {["complete", "failed", "cancelled", "quarantined"].includes(item.status) && (
            <Tip label="Dismiss">
              <Button variant="ghost" size="icon-sm" aria-label={`Dismiss ${item.name}`} onClick={() => manager.remove(item.id)}>
                <X className="size-4" aria-hidden />
              </Button>
            </Tip>
          )}
        </div>
      </div>
    </li>
  );
}

/** Screen-reader announcements for state changes that matter (finished, failed). */
function useAnnouncer(items: UploadItem[]) {
  const [state, setState] = useState<{ seen: Record<string, UploadStatus>; message: string }>({ seen: {}, message: "" });
  // Derived during render (React allows updating a component's own state here) so no effect is needed.
  let next = state;
  for (const it of items) {
    if (next.seen[it.id] !== it.status) {
      let message = next.message;
      if (it.status === "complete") message = `${it.name} finished uploading.`;
      else if (it.status === "failed") message = `${it.name} failed to upload. ${it.error ?? ""}`;
      else if (it.status === "quarantined") message = `${it.name} was quarantined by the security scan.`;
      next = { seen: { ...next.seen, [it.id]: it.status }, message };
    }
  }
  if (next !== state) setState(next);
  return state.message;
}

export function UploadQueue({ compact, className, requestToken, showInterrupted = true }: { compact?: boolean; className?: string; requestToken?: string; showInterrupted?: boolean }) {
  const items = useUploads();
  const manager = useUploadManager();
  const message = useAnnouncer(items);
  const finished = items.filter((i) => ["complete", "failed", "cancelled", "quarantined"].includes(i.status)).length;

  return (
    <div className={className}>
      <div aria-live="polite" className="sr-only-live">
        {message}
      </div>
      {showInterrupted && !compact && (
        <div className="mb-3 empty:hidden">
          <InterruptedUploads requestToken={requestToken} />
        </div>
      )}
      {items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
            <h2 className="text-[13px] font-semibold">
              Uploads <span className="font-normal text-subtle tnum">({items.length})</span>
            </h2>
            {finished > 0 && (
              <Button variant="ghost" size="sm" onClick={() => manager.clearFinished()}>
                Clear finished
              </Button>
            )}
          </div>
          <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">
            {items
              .slice()
              .reverse()
              .map((item) => (
                <Row key={item.id} item={item} compact={compact} />
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
