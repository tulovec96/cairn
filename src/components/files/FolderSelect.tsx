"use client";

import { useMemo } from "react";
import { Select } from "@/components/ui/Field";
import { api } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";
import type { FolderNode } from "./types";

/** A plain dropdown of the workspace's folders, labelled with their full path. `null` is the top level. */
export function FolderSelect({ id, value, onChange, rootLabel = "All files (top level)", "aria-describedby": describedBy, className }: { id?: string; value: string | null; onChange: (id: string | null) => void; rootLabel?: string; "aria-describedby"?: string; className?: string }) {
  const res = useResource("folder-select", (signal) => api<{ folders: FolderNode[] }>("/api/v1/folders", { signal }));
  const options = useMemo(() => {
    const folders = res.data?.folders ?? [];
    const byId = new Map(folders.map((f) => [f.id, f]));
    const pathOf = (f: FolderNode): string => {
      const parts: string[] = [];
      let cur: FolderNode | undefined = f;
      for (let i = 0; cur && i < 32; i++) {
        parts.unshift(cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return parts.join(" / ");
    };
    return folders.map((f) => ({ id: f.id, label: pathOf(f) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [res.data]);

  return (
    <Select id={id} aria-describedby={describedBy} className={className} value={value ?? ""} disabled={!res.data && !res.error} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{rootLabel}</option>
      {value && !options.some((o) => o.id === value) && <option value={value}>Selected folder</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
