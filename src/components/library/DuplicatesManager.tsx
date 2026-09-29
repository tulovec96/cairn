"use client";

import { CopyCheck, Link2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { useCan } from "@/components/layout/AccountContext";
import { api, errorMessage } from "@/lib/api-client";
import { formatBytes, formatDate, pluralize } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { DuplicateGroup } from "@/server/services/library";

const MIN_SIZES = [
  { value: 1, label: "Any size" },
  { value: 1024 * 1024, label: "Over 1 MB" },
  { value: 100 * 1024 * 1024, label: "Over 100 MB" },
];

export function DuplicatesManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const canDelete = useCan("delete");
  const [minSize, setMinSize] = useState(1);
  const res = useResource<{ groups: DuplicateGroup[]; reclaimableBytes: number }>(`dupes:${minSize}`, (signal) => api(`/api/v1/duplicates?minSize=${minSize}`, { signal }));
  const [busy, setBusy] = useState<string | null>(null);

  const trash = async (ids: string[], title: string, description: string, key: string) => {
    if (!(await confirm({ title, description, confirmLabel: "Move to trash", tone: "danger" }))) return;
    setBusy(key);
    try {
      const out = await api<{ done: number; failed: Array<{ message: string }> }>("/api/v1/bulk", { method: "POST", body: { action: "delete", fileIds: ids, folderIds: [] } });
      if (out.failed.length) toast.error("Some files couldn't be moved", out.failed[0].message);
      else toast.success(`Moved ${pluralize(out.done, "file")} to the trash`, "You can restore them from the trash.");
      res.reload();
    } catch (err) {
      toast.error("Couldn't move the files", errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[13px] text-muted">Files with exactly the same content (identical SHA-256), wherever they are. Nothing is ever removed for you: you decide what to keep.</p>
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted">Show</span>
          <select value={minSize} onChange={(e) => setMinSize(Number(e.target.value))} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]">
            {MIN_SIZES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {res.error && <ErrorNotice className="mb-3">{res.error}</ErrorNotice>}
      {!res.data && !res.error ? (
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : res.data && res.data.groups.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<CopyCheck />} title="No duplicates found" description="Every file has unique content. Nice and tidy." />
        </div>
      ) : res.data ? (
        <>
          <p className="mb-3 text-[13px]" aria-live="polite">
            <strong className="tnum">{pluralize(res.data.groups.length, "group")}</strong> of identical files. Keeping one of each would free up <strong className="tnum">{formatBytes(res.data.reclaimableBytes)}</strong>.
          </p>
          <ul className="space-y-3">
            {res.data.groups.map((g) => (
              <li key={g.sha256} className="rounded-lg border border-line bg-surface">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-[13px]">
                  <span className="font-medium tnum">
                    {g.files.length} copies × {formatBytes(g.size)}
                  </span>
                  <Badge tone="warning">{formatBytes(g.reclaimableBytes)} reclaimable</Badge>
                  <code className="ml-auto font-mono text-[11px] text-subtle" title={g.sha256}>
                    {g.sha256.slice(0, 12)}…
                  </code>
                </div>
                <ul className="divide-y divide-line">
                  {g.files.map((f, idx) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
                      <div className="min-w-0 flex-1">
                        <Link href={`/file/${f.id}`} className="block truncate font-medium hover:text-accent hover:underline">
                          {f.name}
                        </Link>
                        <p className="truncate text-xs text-muted">
                          {f.location} · uploaded {formatDate(f.createdAt)}
                          {f.downloads > 0 && ` · ${pluralize(f.downloads, "download")}`}
                        </p>
                      </div>
                      {f.shared && (
                        <Badge icon={<Link2 className="size-3" aria-hidden />} tone="accent">
                          Shared
                        </Badge>
                      )}
                      {idx === 0 && <Badge>Oldest</Badge>}
                      {canDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy === f.id}
                          onClick={() =>
                            trash([f.id], `Move “${f.name}” to the trash?`, f.shared ? "This file has an active share link, which will stop working." : `The other ${g.files.length - 1} ${g.files.length === 2 ? "copy stays" : "copies stay"}.`, f.id)
                          }
                          icon={<Trash2 className="size-4" aria-hidden />}
                        >
                          Trash
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {canDelete && (
                  <div className="border-t border-line px-4 py-2.5">
                    <Button
                      size="sm"
                      loading={busy === g.sha256}
                      onClick={() =>
                        trash(
                          g.files.slice(1).map((f) => f.id),
                          `Keep “${g.files[0].name}” and trash ${g.files.length - 1} ${g.files.length === 2 ? "copy" : "copies"}?`,
                          `The oldest copy stays. ${g.files.slice(1).some((f) => f.shared) ? "At least one of the copies has a share link, which will stop working. " : ""}Trashed files can be restored.`,
                          g.sha256,
                        )
                      }
                    >
                      Keep oldest, trash the rest
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
