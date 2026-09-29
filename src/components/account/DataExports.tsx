"use client";

import { Download, PackageOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatBytes, formatDateTime, timeUntil } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { DataExportDto } from "@/server/services/transfer";

export function DataExports() {
  const toast = useToast();
  const res = useResource<{ items: DataExportDto[] }>("exports", (signal) => api<{ items: DataExportDto[] }>("/api/v1/account/exports", { signal }));
  const [busy, setBusy] = useState(false);
  const items = res.data?.items ?? null;
  const active = !!items?.some((e) => e.status === "queued" || e.status === "running");
  const { reload } = res;

  // While an export is being built, look again every few seconds.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [active, reload]);

  const request = async () => {
    setBusy(true);
    try {
      await api("/api/v1/account/exports", { method: "POST" });
      toast.success("Preparing your export", "It'll show up here when it's ready.");
      reload();
    } catch (err) {
      toast.error("Couldn't start the export", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-[13px] text-muted">A ZIP with your profile, settings, folder structure, file metadata, share links (without secrets) and your personal files. Links stay valid for a limited time.</p>
      <div className="mt-3">
        <Button variant="primary" onClick={request} loading={busy} disabled={active} icon={<PackageOpen className="size-4" aria-hidden />}>
          {active ? "Export in progress…" : "Request export"}
        </Button>
      </div>
      {res.error && <ErrorNotice className="mt-3">{res.error}</ErrorNotice>}
      {!items && !res.error && <Skeleton className="mt-4 h-12" />}
      {items && items.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line" aria-label="Your exports">
          {items.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
              <Badge tone={e.status === "ready" ? "success" : e.status === "failed" ? "danger" : "accent"}>{e.status}</Badge>
              <span className="text-muted">Requested {formatDateTime(e.createdAt)}</span>
              {e.size != null && <span className="tnum text-muted">{formatBytes(e.size)}</span>}
              {e.status === "failed" && e.error && <span className="text-xs text-danger">{e.error}</span>}
              {e.status === "ready" && (
                <>
                  <span className="text-xs text-subtle">expires {timeUntil(e.expiresAt)}</span>
                  <a href={`/api/v1/account/exports/${e.id}/download`} className="ml-auto inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                    <Download className="size-4" aria-hidden /> Download
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
