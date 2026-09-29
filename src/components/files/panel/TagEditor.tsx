"use client";

import { Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";
import type { TagDto } from "@/lib/types";

/** Tag chips for one file, with suggestions from the workspace's existing tags. Changes are saved immediately. */
export function TagEditor({ fileId, tags, onChanged, readOnly }: { fileId: string; tags: TagDto[]; onChanged: () => void; readOnly?: boolean }) {
  const toast = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const all = useResource<{ items: Array<TagDto & { fileCount: number }> }>("tags-all", (signal) => api("/api/v1/tags", { signal }));
  const suggestions = (all.data?.items ?? []).filter((t) => !tags.some((x) => x.id === t.id) && (!value || t.name.toLowerCase().includes(value.toLowerCase()))).slice(0, 6);

  const apply = async (body: { add?: string[]; removeIds?: string[] }) => {
    setBusy(true);
    try {
      await api("/api/v1/bulk", { method: "POST", body: { action: "tag", fileIds: [fileId], ...body } });
      all.reload();
      onChanged();
    } catch (err) {
      toast.error("Couldn't change tags", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setValue("");
    await apply({ add: [clean] });
  };

  return (
    <div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
        {tags.length === 0 && <li className="text-[13px] text-subtle">No tags yet.</li>}
        {tags.map((t) => (
          <li key={t.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pr-1 pl-2 text-xs font-medium">
            <span aria-hidden className="size-2 rounded-full" style={{ background: t.color }} />
            {t.name}
            {!readOnly && (
              <button type="button" aria-label={`Remove tag ${t.name}`} disabled={busy} onClick={() => void apply({ removeIds: [t.id] })} className="flex size-4 items-center justify-center rounded-full text-subtle hover:bg-surface-3 hover:text-fg">
                <X className="size-3" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form
          className="mt-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void add(value);
          }}
        >
          <div className="flex gap-1.5">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={40}
              placeholder="Add a tag…"
              aria-label="New tag"
              className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none"
            />
            <button type="submit" disabled={busy || !value.trim()} className="inline-flex h-8 items-center gap-1 rounded-md border border-line-strong px-2.5 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50">
              <Plus className="size-3.5" aria-hidden /> Add
            </button>
          </div>
          {suggestions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {suggestions.map((t) => (
                <button key={t.id} type="button" onClick={() => void add(t.name)} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-fg">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: t.color }} /> {t.name}
                </button>
              ))}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
