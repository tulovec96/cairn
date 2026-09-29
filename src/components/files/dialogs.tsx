"use client";

import { Check, Download, Folder, Home } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useResource } from "@/lib/useResource";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field, Input } from "@/components/ui/Field";
import { ErrorNotice, ProgressBar, Spinner } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage, shareLink } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatBytes, pluralize } from "@/lib/format";
import type { ArchiveJobDto, LimitsDto, ShareDto } from "@/lib/types";
import { DEFAULT_EXPIRY, ExpiryField, expiryValueToApi, type ExpiryValue } from "./ExpiryField";
import { idOf, nameOf, splitItems, type FolderNode, type Item } from "./types";

export { ShareDialog, type ShareTarget } from "./ShareDialog";

/* ---------------------------------------------------------------------------------------------- */

export function RenameDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(nameOf(item));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name === nameOf(item)) return onClose();
    setBusy(true);
    setError(null);
    try {
      await api(item.kind === "file" ? `/api/v1/files/${idOf(item)}` : `/api/v1/folders/${idOf(item)}`, { method: "PATCH", body: { name: name.trim() } });
      toast.success("Renamed");
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Rename ${item.kind}`} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Field label="Name">
          {(p) => (
            <Input
              {...p}
              value={name}
              maxLength={255}
              autoFocus
              required
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => {
                const dot = item.kind === "file" ? e.currentTarget.value.lastIndexOf(".") : -1;
                e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length);
              }}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Rename
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function NewFolderDialog({ parentId, onClose, onDone }: { parentId: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/folders", { method: "POST", body: { name: name.trim(), parentId } });
      toast.success("Folder created");
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="New folder" size="sm">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Field label="Folder name">{(p) => <Input {...p} value={name} maxLength={255} autoFocus required onChange={(e) => setName(e.target.value)} placeholder="e.g. Project assets" />}</Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------------------------- */

export function MoveDialog({ items, mode = "move", onClose, onDone }: { items: Item[]; mode?: "move" | "copy"; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const foldersRes = useResource("move-folders", (signal) => api<{ folders: FolderNode[] }>("/api/v1/folders", { signal }));
  const folders = foldersRes.data?.folders ?? null;
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? foldersRes.error;
  const setError = setActionError;

  const { fileIds, folderIds } = splitItems(items);

  // A folder can't be moved into itself or anything beneath it.
  const blocked = useMemo(() => {
    const set = new Set<string>(folderIds);
    if (!folders) return set;
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders) {
        if (f.parentId && set.has(f.parentId) && !set.has(f.id)) {
          set.add(f.id);
          grew = true;
        }
      }
    }
    return set;
  }, [folders, folderIds]);

  const children = useMemo(() => {
    const map = new Map<string | null, FolderNode[]>();
    for (const f of folders ?? []) map.set(f.parentId, [...(map.get(f.parentId) ?? []), f]);
    return map;
  }, [folders]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ done: number; failed: Array<{ id: string; message: string }> }>("/api/v1/bulk", { method: "POST", body: { action: mode, fileIds, ...(mode === "move" ? { folderIds } : {}), targetFolderId: target } });
      if (res.failed.length) {
        setError(res.failed[0].message);
        setBusy(false);
        if (res.done) onDone();
        return;
      }
      toast.success(`${mode === "copy" ? "Copied" : "Moved"} ${pluralize(res.done, "item")}`);
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const renderLevel = (parent: string | null, depth: number) =>
    (children.get(parent) ?? []).map((f) => {
      const disabled = blocked.has(f.id);
      const selected = target === f.id;
      return (
        <li key={f.id}>
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => setTarget(f.id)}
            style={{ paddingLeft: 10 + depth * 18 }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-[13px] transition-colors",
              selected ? "bg-accent-soft text-fg" : "hover:bg-surface-2",
              disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
            )}
          >
            <Folder className="size-4 shrink-0 text-warning" aria-hidden />
            <span className="truncate">{f.name}</span>
            {selected && <Check className="ml-auto size-4 text-accent" aria-hidden />}
          </button>
          {(children.get(f.id)?.length ?? 0) > 0 && <ul>{renderLevel(f.id, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${mode === "copy" ? "Copy" : "Move"} ${pluralize(items.length, "item")}`}
      description={mode === "copy" ? `Copies count against your storage.${items.length === 1 ? ` ${nameOf(items[0])}` : ""}` : items.length === 1 ? nameOf(items[0]) : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!folders}>
            {mode === "copy" ? "Copy here" : "Move here"}
          </Button>
        </>
      }
    >
      {error && <ErrorNotice className="mb-3">{error}</ErrorNotice>}
      {!folders ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div role="radiogroup" aria-label="Destination folder" className="max-h-72 overflow-y-auto rounded-md border border-line p-1">
          <button
            type="button"
            role="radio"
            aria-checked={target === null}
            onClick={() => setTarget(null)}
            className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px]", target === null ? "bg-accent-soft" : "hover:bg-surface-2")}
          >
            <Home className="size-4 text-subtle" aria-hidden /> All files (top level)
            {target === null && <Check className="ml-auto size-4 text-accent" aria-hidden />}
          </button>
          <ul>{renderLevel(null, 1)}</ul>
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------------------------------------- */

export function ExpiryDialog({ items, limits, onClose, onDone }: { items: Item[]; limits: LimitsDto; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState<ExpiryValue>({ ...DEFAULT_EXPIRY, choice: "7d" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fileIds } = splitItems(items);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const expiresAt = expiryValueToApi(value);
    if (expiresAt === undefined) return setError("Choose when the files should expire.");
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ done: number; failed: Array<{ message: string }> }>("/api/v1/bulk", { method: "POST", body: { action: "expiry", fileIds, expiresAt } });
      if (res.failed.length) {
        setError(res.failed[0].message);
        setBusy(false);
        return;
      }
      toast.success(expiresAt === null ? "Files will be kept until you delete them" : `Expiry updated for ${pluralize(res.done, "file")}`);
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Change expiration" description={`${pluralize(fileIds.length, "file")} selected. Expired files are permanently deleted.`} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <ExpiryField value={value} onChange={setValue} limits={limits} allowKeep={false} label="Delete files" />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------------------------- */

export function ShareResultsDialog({ shares, failed, onClose }: { shares: ShareDto[]; failed: number; onClose: () => void }) {
  const text = shares.map((s) => `${s.targetName ?? "Item"}: ${shareLink(s.token)}`).join("\n");
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${pluralize(shares.length, "link")} created`}
      description={failed ? `${failed} could not be shared.` : undefined}
      size="lg"
      footer={
        <>
          <CopyButton value={text} label="Copy all" successMessage="All links copied" variant="primary" size="md" />
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <ul className="divide-y divide-line rounded-md border border-line">
        {shares.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{s.targetName}</p>
              <p className="truncate font-mono text-xs text-muted">{shareLink(s.token)}</p>
            </div>
            <CopyButton value={shareLink(s.token)} iconOnly size="sm" />
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------------------------- */

export function ArchiveDialog({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const [job, setJob] = useState<ArchiveJobDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { fileIds, folderIds } = useMemo(() => splitItems(items), [items]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (id: string) => {
      try {
        const { archive } = await api<{ archive: ArchiveJobDto }>(`/api/v1/archives/${id}`);
        if (stopped) return;
        setJob(archive);
        if (archive.status === "ready") {
          const a = document.createElement("a");
          a.href = `/api/v1/archives/${archive.id}/download`;
          a.download = archive.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          return;
        }
        if (archive.status === "failed" || archive.status === "expired") {
          setError(archive.error ?? "The archive couldn't be created.");
          return;
        }
        timer = setTimeout(() => void poll(id), 700);
      } catch (err) {
        if (!stopped) setError(errorMessage(err));
      }
    };
    api<{ archive: ArchiveJobDto }>("/api/v1/archives", { method: "POST", body: { fileIds, folderIds } }).then(
      ({ archive }) => {
        if (stopped) return;
        setJob(archive);
        void poll(archive.id);
      },
      (err) => !stopped && setError(errorMessage(err)),
    );
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [fileIds, folderIds]);

  const pct = job && job.totalBytes > 0 ? (job.processedBytes / job.totalBytes) * 100 : job?.status === "ready" ? 100 : 0;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Preparing download"
      description={job ? `${job.name} · ${pluralize(job.totalFiles, "file")} · ${formatBytes(job.totalBytes)}` : "Collecting your files…"}
      size="sm"
      footer={
        job?.status === "ready" ? (
          <>
            <a href={`/api/v1/archives/${job.id}/download`} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong px-3.5 text-sm font-medium hover:bg-surface-2">
              <Download className="size-4" aria-hidden /> Download again
            </a>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{error ? "Close" : "Cancel"}</Button>
        )
      }
    >
      {error ? (
        <ErrorNotice>{error}</ErrorNotice>
      ) : (
        <div className="space-y-2.5 py-1">
          <ProgressBar label="Archive progress" value={job?.status === "queued" || !job ? null : pct} tone={job?.status === "ready" ? "success" : "accent"} />
          <p className="text-xs text-muted tnum" aria-live="polite">
            {!job || job.status === "queued"
              ? "Waiting to start…"
              : job.status === "running"
                ? `${job.processedFiles} of ${job.totalFiles} files · ${formatBytes(job.processedBytes)} of ${formatBytes(job.totalBytes)}`
                : "Ready — your download should start automatically."}
          </p>
        </div>
      )}
    </Modal>
  );
}
