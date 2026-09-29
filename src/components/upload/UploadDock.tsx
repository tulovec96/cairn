"use client";

import { ChevronDown, ChevronUp, UploadCloud } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { UploadQueue } from "./UploadQueue";
import { useUploads } from "./UploadProvider";

const INLINE_QUEUE_ROUTES = new Set(["/", "/upload", "/files", "/my-uploads"]);

/** Floating summary of the upload queue on pages that don't show the full queue inline. */
export function UploadDock() {
  const items = useUploads();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  // These pages render the full queue inline, so the floating summary would just duplicate it.
  if (!items.length || INLINE_QUEUE_ROUTES.has(pathname)) return null;

  const active = items.filter((i) => ["waiting", "uploading", "retrying", "hashing", "finalizing", "processing", "scanning", "paused"].includes(i.status));
  const total = items.reduce((n, i) => n + i.size, 0);
  const sent = items.reduce((n, i) => n + (i.status === "complete" ? i.size : i.uploadedBytes), 0);
  const pct = total ? Math.round((sent / total) * 100) : 0;
  const failed = items.filter((i) => i.status === "failed").length;

  return (
    <div className="fixed right-3 bottom-3 z-40 w-[min(26rem,calc(100vw-1.5rem))] sm:right-4 sm:bottom-4">
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2"
        >
          <UploadCloud className={cn("size-4", active.length ? "text-accent" : "text-success")} aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-medium">
            {active.length ? `Uploading ${active.length} ${active.length === 1 ? "file" : "files"}` : failed ? `${failed} failed` : "Uploads complete"}
            <span className="ml-2 font-normal text-subtle tnum">
              {formatBytes(sent)} / {formatBytes(total)}
            </span>
          </span>
          {active.length > 0 && <span className="text-xs font-medium text-muted tnum">{pct}%</span>}
          {open ? <ChevronDown className="size-4 text-subtle" aria-hidden /> : <ChevronUp className="size-4 text-subtle" aria-hidden />}
        </button>
        {open && <UploadQueue compact className="[&>div]:rounded-none [&>div]:border-0 [&>div]:border-t [&_ul]:max-h-72" />}
      </div>
    </div>
  );
}
