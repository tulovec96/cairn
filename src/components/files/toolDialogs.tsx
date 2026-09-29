"use client";

import { AlertTriangle, ArrowRight, Check, Pin } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { notifySavedSearchesChanged } from "@/components/layout/SavedSearchesNav";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { CONFLICT_MESSAGES, type RenameRow } from "@/lib/batchRename";
import { cn } from "@/lib/cn";
import { pluralize } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { TagDto } from "@/lib/types";
import { splitItems, type Item } from "./types";

/* ---------------------------------------------------------------------------------------------- */

/** Add and remove tags for the whole selection in one step. */
export function TagDialog({ items, onClose, onDone }: { items: Item[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { fileIds } = splitItems(items);
  const tagsRes = useResource<{ items: Array<TagDto & { fileCount: number }> }>("tag-dialog", (signal) => api("/api/v1/tags", { signal }));
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [fresh, setFresh] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tags = tagsRes.data?.items ?? [];

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const newNames = fresh.split(",").map((s) => s.trim()).filter(Boolean);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/bulk", { method: "POST", body: { action: "tag", fileIds, add: [...add, ...newNames], removeIds: remove } });
      toast.success(`Updated tags on ${pluralize(fileIds.length, "file")}`);
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Tags" description={`Applies to ${pluralize(fileIds.length, "file")}.`} size="md">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {tagsRes.error && <ErrorNotice>{tagsRes.error}</ErrorNotice>}
        {!tagsRes.data ? (
          <Skeleton className="h-16" />
        ) : (
          tags.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium">Add</legend>
                <ul className="max-h-44 space-y-1 overflow-y-auto">
                  {tags.map((t) => (
                    <li key={t.id}>
                      <Checkbox checked={add.includes(t.name)} onChange={() => { toggle(add, setAdd, t.name); setRemove(remove.filter((r) => r !== t.id)); }} label={<span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full" style={{ background: t.color }} />{t.name}</span>} />
                    </li>
                  ))}
                </ul>
              </fieldset>
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium">Remove</legend>
                <ul className="max-h-44 space-y-1 overflow-y-auto">
                  {tags.map((t) => (
                    <li key={t.id}>
                      <Checkbox checked={remove.includes(t.id)} onChange={() => { toggle(remove, setRemove, t.id); setAdd(add.filter((a) => a !== t.name)); }} label={<span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full" style={{ background: t.color }} />{t.name}</span>} />
                    </li>
                  ))}
                </ul>
              </fieldset>
            </div>
          )
        )}
        <Field label="New tags" optional hint="Separate several with commas.">
          {(p) => <Input {...p} value={fresh} onChange={(e) => setFresh(e.target.value)} maxLength={200} placeholder="e.g. invoices, 2030" />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!add.length && !remove.length && !newNames.length}>
            Apply
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------------------------- */

const PATTERN_HELP = [
  ["{name}", "the original name without its extension"],
  ["{ext}", "the original extension"],
  ["{number}", "1, 2, 3 …  ({number:3} gives 001, 002 …)"],
  ["{date}", "today's date"],
  ["{created}", "the file's upload date"],
] as const;

/** Rename many files by pattern. The preview comes from the server, so it is exactly what will happen. */
export function BatchRenameDialog({ items, onClose, onDone }: { items: Item[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { fileIds } = splitItems(items);
  const [pattern, setPattern] = useState("{name}-{number:2}");
  const [start, setStart] = useState("1");
  const [rows, setRows] = useState<{ key: string; rows: RenameRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = `${pattern}|${start}`;

  useEffect(() => {
    if (!pattern.trim()) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<{ rows: RenameRow[] }>("/api/v1/batch-rename", { method: "POST", body: { fileIds, pattern, start: Number(start) || 0 }, signal: ctrl.signal }).then(
        (res) => {
          setRows({ key, rows: res.rows });
          setError(null);
        },
        (err) => (err as Error).name !== "AbortError" && setError(errorMessage(err)),
      );
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [pattern, start, key, fileIds]);

  const current = rows?.key === key ? rows.rows : null;
  const conflicts = current?.filter((r) => r.conflict).length ?? 0;

  const apply = async () => {
    setBusy(true);
    try {
      const res = await api<{ renamed: number }>("/api/v1/batch-rename", { method: "POST", body: { fileIds, pattern, start: Number(start) || 0, apply: true } });
      toast.success(`Renamed ${pluralize(res.renamed, "file")}`);
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Rename in bulk"
      description={`${pluralize(fileIds.length, "file")}, in the order shown. Nothing changes until you apply.`}
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} loading={busy} disabled={!current || conflicts > 0}>
            Rename {pluralize(fileIds.length, "file")}
          </Button>
        </>
      }
    >
      {error && <ErrorNotice className="mb-3">{error}</ErrorNotice>}
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <Field label="Pattern">{(p) => <Input {...p} value={pattern} onChange={(e) => setPattern(e.target.value)} maxLength={200} autoFocus className="font-mono" />}</Field>
        <Field label="Start at">{(p) => <Input {...p} inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} />}</Field>
      </div>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer select-none">Pattern placeholders</summary>
        <dl className="mt-1.5 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5">
          {PATTERN_HELP.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-1.5">The original extension is kept unless your pattern contains {"{ext}"}.</p>
      </details>
      <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-line">
        {!current ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {current.map((r) => (
              <li key={r.id} className={cn("flex items-center gap-2 px-3 py-1.5", r.conflict && "bg-danger-soft")}>
                <span className="min-w-0 flex-1 truncate text-muted" title={r.from}>{r.from}</span>
                <ArrowRight className="size-3.5 shrink-0 text-subtle" aria-hidden />
                <span className={cn("min-w-0 flex-1 truncate font-medium", r.conflict && "text-danger")} title={r.to}>{r.to}</span>
                {r.conflict ? <span className="flex shrink-0 items-center gap-1 text-xs text-danger"><AlertTriangle className="size-3.5" aria-hidden />{CONFLICT_MESSAGES[r.conflict]}</span> : r.to !== r.from ? <Check className="size-3.5 shrink-0 text-success" aria-hidden /> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {conflicts > 0 && <p className="mt-2 text-xs text-danger">Fix the {pluralize(conflicts, "conflict")} above to continue.</p>}
    </Modal>
  );
}

/* ---------------------------------------------------------------------------------------------- */

export function SaveSearchDialog({ query, onClose }: { query: string; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(query.length > 40 ? `${query.slice(0, 37)}…` : query);
  const [pinned, setPinned] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/saved-searches", { method: "POST", body: { name: name.trim(), query, pinned } });
      notifySavedSearchesChanged();
      toast.success("Search saved", "It's in the sidebar now.");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Save this search" description={<code className="font-mono text-xs break-all">{query}</code>} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus required />}</Field>
        <Checkbox checked={pinned} onChange={(e) => setPinned(e.target.checked)} label={<span className="inline-flex items-center gap-1.5"><Pin className="size-3.5" aria-hidden /> Pin to the top of the list</span>} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            Save search
          </Button>
        </div>
      </form>
    </Modal>
  );
}
