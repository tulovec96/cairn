"use client";

import { Download, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { UpgradeNotice } from "@/components/common/Upgrade";
import { useAccount, useCan } from "@/components/layout/AccountContext";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Badge, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { useUploadComplete, useUploadManager } from "@/components/upload/UploadProvider";
import { api, errorMessage } from "@/lib/api-client";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { VersionDto } from "@/server/services/versions";

/** Version history: upload a new version, download or restore an older one. Limits and retention come from the plan. */
export function VersionsTab({ fileId, fileName, onChanged }: { fileId: string; fileName: string; onChanged: () => void }) {
  const { plan } = useAccount();
  const canWrite = useCan("write");
  const canDelete = useCan("delete");
  const toast = useToast();
  const confirm = useConfirm();
  const manager = useUploadManager();
  const picker = useRef<HTMLInputElement>(null);
  const enabled = plan.features.fileVersioning;
  const res = useResource<{ items: VersionDto[] }>(`versions-${fileId}`, (signal) => (enabled ? api(`/api/v1/files/${fileId}/versions`, { signal }) : Promise.resolve({ items: [] })));
  const { reload } = res;

  useUploadComplete((item) => {
    if (item.options.replaceFileId === fileId) {
      reload();
      onChanged();
    }
  });

  if (!enabled) return <UpgradeNotice feature="fileVersioning" />;
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  const cap = plan.limits.versionsPerFile;

  const restore = async (v: VersionDto) => {
    if (!(await confirm({ title: `Restore version ${v.version}?`, description: "It becomes the current version. The version it replaces is kept, so nothing is lost.", confirmLabel: "Restore" }))) return;
    try {
      await api(`/api/v1/files/${fileId}/versions/${v.version}`, { method: "POST", body: {} });
      toast.success(`Version ${v.version} restored`);
      reload();
      onChanged();
    } catch (err) {
      toast.error("Couldn't restore", errorMessage(err));
    }
  };
  const remove = async (v: VersionDto) => {
    if (!(await confirm({ title: `Delete version ${v.version}?`, description: "This permanently removes that version's data.", confirmLabel: "Delete", tone: "danger" }))) return;
    try {
      await api(`/api/v1/files/${fileId}/versions/${v.version}`, { method: "DELETE" });
      reload();
    } catch (err) {
      toast.error("Couldn't delete", errorMessage(err));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] text-muted">
          {cap < 0 ? "Every version is kept." : `Up to ${cap} older ${cap === 1 ? "version" : "versions"} are kept.`} Older versions count against your storage.
        </p>
        {canWrite && (
          <>
            <input
              ref={picker}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) manager.add([f], { replaceFileId: fileId, share: false });
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="primary" onClick={() => picker.current?.click()} icon={<Upload className="size-3.5" aria-hidden />}>
              Upload new version
            </Button>
          </>
        )}
      </div>
      {!res.data ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {res.data.items.map((v) => (
            <li key={v.version} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  Version {v.version} {v.current && <Badge tone="accent">Current</Badge>}
                </p>
                <p className="text-xs text-muted tnum">
                  {formatBytes(v.size)} · {formatDateTime(v.createdAt)}
                  {v.createdBy ? ` · ${v.createdBy}` : ""}
                </p>
                {v.note && <p className="text-xs text-subtle">{v.note}</p>}
              </div>
              <a href={`/api/v1/files/${fileId}/versions/${v.version}/download`} download={fileName} aria-label={`Download version ${v.version}`} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
                <Download className="size-4" aria-hidden />
              </a>
              {!v.current && canWrite && (
                <Button size="icon-sm" variant="ghost" aria-label={`Restore version ${v.version}`} onClick={() => void restore(v)}>
                  <RotateCcw className="size-4" aria-hidden />
                </Button>
              )}
              {!v.current && canDelete && (
                <Button size="icon-sm" variant="ghost" aria-label={`Delete version ${v.version}`} onClick={() => void remove(v)}>
                  <Trash2 className="size-4 text-danger" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
