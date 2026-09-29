"use client";

import { Plus, Save, Trash } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { FileDto } from "@/lib/types";

export const LABEL_COLORS = ["#d4453f", "#e2703a", "#d99a1c", "#3aa655", "#0f9d8a", "#2557e8", "#9556d6", "#d24f95", "#6b7691"] as const;

/** Description, private notes, color label and custom key/value metadata for a file. */
export function MetadataForm({ file, onChanged, readOnly }: { file: FileDto; onChanged: () => void; readOnly?: boolean }) {
  const toast = useToast();
  const [description, setDescription] = useState(file.description);
  const [notes, setNotes] = useState(file.notes);
  const [color, setColor] = useState<string | null>(file.colorLabel);
  const [pairs, setPairs] = useState<Array<[string, string]>>(Object.entries(file.metadata));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const metadata = Object.fromEntries(pairs.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]));
      await api(`/api/v1/files/${file.id}`, { method: "PATCH", body: { description, notes, colorLabel: color, metadata } });
      toast.success("Saved");
      onChanged();
    } catch (err) {
      toast.error("Couldn't save", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Description" hint="Shown to teammates and searchable with has:description.">
        {(p) => <Textarea {...p} rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} />}
      </Field>
      <Field label="Private notes" hint="Only people in this workspace can see these.">
        {(p) => <Textarea {...p} rows={3} maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={readOnly} />}
      </Field>
      <div>
        <p className="mb-1.5 text-[13px] font-medium">Color label</p>
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Color label">
          <button type="button" role="radio" aria-checked={color === null} disabled={readOnly} onClick={() => setColor(null)} className={cn("h-6 rounded-full border px-2 text-xs", color === null ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:bg-surface-2")}>
            None
          </button>
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Color ${c}`}
              disabled={readOnly}
              onClick={() => setColor(c)}
              className={cn("size-6 rounded-full border-2", color === c ? "border-fg" : "border-transparent")}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[13px] font-medium">Custom metadata</p>
        <div className="space-y-1.5">
          {pairs.map(([k, v], i) => (
            <div key={i} className="flex gap-1.5">
              <Input aria-label="Metadata name" placeholder="name" value={k} maxLength={60} disabled={readOnly} onChange={(e) => setPairs(pairs.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} className="h-8 w-2/5 text-[13px]" />
              <Input aria-label="Metadata value" placeholder="value" value={v} maxLength={500} disabled={readOnly} onChange={(e) => setPairs(pairs.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} className="h-8 flex-1 text-[13px]" />
              {!readOnly && (
                <Button size="icon-sm" variant="ghost" aria-label="Remove this field" onClick={() => setPairs(pairs.filter((_, j) => j !== i))}>
                  <Trash className="size-4" aria-hidden />
                </Button>
              )}
            </div>
          ))}
          {!readOnly && pairs.length < 30 && (
            <Button size="sm" variant="ghost" onClick={() => setPairs([...pairs, ["", ""]])} icon={<Plus className="size-3.5" aria-hidden />}>
              Add a field
            </Button>
          )}
        </div>
      </div>
      {!readOnly && (
        <Button variant="primary" onClick={save} loading={saving} icon={<Save className="size-4" aria-hidden />}>
          Save changes
        </Button>
      )}
    </div>
  );
}
