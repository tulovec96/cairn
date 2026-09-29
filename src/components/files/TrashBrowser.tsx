"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Checkbox } from "@/components/ui/Field";
import { EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { FolderIcon } from "@/components/ui/FileIcon";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";
import { formatBytes, formatDateTime, pluralize, timeAgo, timeUntil } from "@/lib/format";
import type { TrashItemDto } from "@/lib/types";
import { File } from "lucide-react";

export function TrashBrowser({ retentionDays }: { retentionDays: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const res = useResource("trash", (signal) => api<{ items: TrashItemDto[] }>("/api/v1/trash", { signal }));
  const items = res.data?.items ?? null;
  const error = res.error;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async () => res.reload();

  const ids = selected.size ? [...selected] : [];
  const bulk = async (action: "restore" | "purge") => {
    if (action === "purge" && !(await confirm({ title: `Permanently delete ${pluralize(ids.length, "item")}?`, description: "This frees the storage and can't be undone.", confirmLabel: "Delete forever", tone: "danger" }))) return;
    setBusy(true);
    try {
      const res = await api<{ done: number; failed: Array<{ message: string }> }>("/api/v1/bulk", { method: "POST", body: { action, trashIds: ids } });
      if (res.failed.length) toast.error(`${res.failed.length} could not be ${action === "restore" ? "restored" : "deleted"}`, res.failed[0].message);
      if (res.done) toast.success(action === "restore" ? `Restored ${pluralize(res.done, "item")}` : `Permanently deleted ${pluralize(res.done, "item")}`);
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.error("Something went wrong", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const empty = async () => {
    if (!(await confirm({ title: "Empty the trash?", description: `Everything in the trash (${pluralize(items?.length ?? 0, "item")}) will be permanently deleted.`, confirmLabel: "Empty trash", tone: "danger" }))) return;
    setBusy(true);
    try {
      const res = await api<{ destroyed: number }>("/api/v1/trash", { method: "DELETE" });
      toast.success(`Deleted ${pluralize(res.destroyed, "file")} permanently`);
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.error("Couldn't empty the trash", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const all = items && items.length > 0 && items.every((i) => selected.has(i.id));
  const totalBytes = (items ?? []).reduce((n, i) => n + i.size, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        {selected.size > 0 ? (
          <>
            <span className="font-medium tnum">{selected.size} selected</span>
            <Button size="sm" onClick={() => bulk("restore")} loading={busy} icon={<RotateCcw className="size-4" aria-hidden />}>
              Restore
            </Button>
            <Button size="sm" variant="danger-outline" onClick={() => bulk("purge")} disabled={busy} icon={<Trash2 className="size-4" aria-hidden />}>
              Delete forever
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted">
              Items are permanently deleted {retentionDays} days after they were moved here.
              {items && items.length > 0 && <span className="ml-1 tnum">Using {formatBytes(totalBytes)}.</span>}
            </p>
            <Button size="sm" variant="danger-outline" className="ml-auto" disabled={!items?.length || busy} onClick={empty} icon={<Trash2 className="size-4" aria-hidden />}>
              Empty trash
            </Button>
          </>
        )}
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
        ) : items.length === 0 ? (
          <EmptyState icon={<Trash2 />} title="Trash is empty" description="Files and folders you delete stay here so you can restore them." />
        ) : (
          <div role="table" aria-label="Trash">
            <div role="row" className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-3 py-2 md:grid-cols-[2rem_minmax(0,1fr)_6rem_10rem_9rem_auto]">
              <div role="columnheader">
                <Checkbox checked={!!all} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} aria-label="Select all" />
              </div>
              <div role="columnheader" className="text-xs font-medium text-subtle">Name</div>
              <div role="columnheader" className="hidden text-xs font-medium text-subtle md:block">Size</div>
              <div role="columnheader" className="hidden text-xs font-medium text-subtle md:block">Deleted</div>
              <div role="columnheader" className="hidden text-xs font-medium text-subtle md:block">Removed for good</div>
              <div role="columnheader" className="sr-only">Actions</div>
            </div>
            {items.map((i) => (
              <div key={i.id} role="row" className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-surface-2 md:grid-cols-[2rem_minmax(0,1fr)_6rem_10rem_9rem_auto]">
                <div role="gridcell">
                  <Checkbox
                    checked={selected.has(i.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const n = new Set(prev);
                        if (e.target.checked) n.add(i.id);
                        else n.delete(i.id);
                        return n;
                      })
                    }
                    aria-label={`Select ${i.name}`}
                  />
                </div>
                <div role="gridcell" className="flex min-w-0 items-center gap-3">
                  {i.kind === "folder" ? (
                    <FolderIcon />
                  ) : (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-muted">
                      <File className="size-4" aria-hidden />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium" title={i.name}>
                      {i.name}
                    </p>
                    <p className="text-xs text-muted md:hidden tnum">
                      {formatBytes(i.size)} · {timeAgo(i.deletedAt)}
                    </p>
                    {i.kind === "folder" && <p className="hidden text-xs text-muted md:block">{pluralize(i.itemCount, "item")} inside</p>}
                  </div>
                </div>
                <div role="gridcell" className="hidden text-xs text-muted tnum md:block">{formatBytes(i.size)}</div>
                <div role="gridcell" className="hidden text-xs text-muted md:block">{formatDateTime(i.deletedAt)}</div>
                <div role="gridcell" className="hidden text-xs text-muted md:block">{timeUntil(i.purgeAt)}</div>
                <div role="gridcell" className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await api(`/api/v1/trash/${i.id}`, { method: "POST", body: {} });
                        toast.success(`Restored “${i.name}”`);
                        await load();
                      } catch (err) {
                        toast.error("Couldn't restore", errorMessage(err));
                      }
                    }}
                    icon={<RotateCcw className="size-3.5" aria-hidden />}
                  >
                    <span className="hidden sm:inline">Restore</span>
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${i.name} forever`}
                    onClick={async () => {
                      if (!(await confirm({ title: `Delete “${i.name}” forever?`, description: "This can't be undone.", confirmLabel: "Delete forever", tone: "danger" }))) return;
                      try {
                        await api(`/api/v1/trash/${i.id}`, { method: "DELETE" });
                        toast.success("Deleted permanently");
                        await load();
                      } catch (err) {
                        toast.error("Couldn't delete", errorMessage(err));
                      }
                    }}
                  >
                    <Trash2 className="size-4 text-danger" aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
