"use client";

import { Download, Eye } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FileIcon } from "@/components/ui/FileIcon";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Feedback";
import { formatBytes } from "@/lib/format";
import type { PublicShareDto } from "@/lib/types";
import { FilePreview } from "./FilePreview";

type Item = NonNullable<PublicShareDto["folder"]>["items"][number];

export function FolderShareList({ token, items, totalFiles, canDownload = true }: { token: string; items: Item[]; totalFiles: number; canDownload?: boolean }) {
  const [preview, setPreview] = useState<Item | null>(null);
  if (!items.length) return <p className="rounded-lg border border-line bg-surface px-4 py-10 text-center text-[13px] text-muted">This folder is empty.</p>;
  return (
    <>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {items.map((item) => {
          const ready = item.status === "available";
          return (
            <li key={item.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <FileIcon category={item.category} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium" title={item.path}>
                  {item.path}
                </p>
                <p className="text-xs text-muted tnum">{formatBytes(item.size)}</p>
              </div>
              {!ready && <Badge tone={item.status === "quarantined" ? "danger" : "accent"}>{item.status === "quarantined" ? "Blocked" : "Scanning"}</Badge>}
              {ready && item.previewKind && (
                <Button variant="ghost" size="icon-sm" aria-label={`Preview ${item.name}`} onClick={() => setPreview(item)}>
                  <Eye className="size-4" aria-hidden />
                </Button>
              )}
              {ready && canDownload ? (
                <a
                  href={`/dl/${token}?f=${item.id}`}
                  download
                  aria-label={`Download ${item.name}`}
                  className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
                >
                  <Download className="size-4" aria-hidden />
                </a>
              ) : (
                <span className="size-8" />
              )}
            </li>
          );
        })}
      </ul>
      {totalFiles > items.length && <p className="text-center text-xs text-subtle">Showing the first {items.length} of {totalFiles} files. Use “Download all” to get everything.</p>}
      <Modal open={!!preview} onOpenChange={(o) => !o && setPreview(null)} title={preview?.name ?? "Preview"} size="xl">
        {preview?.previewKind && <FilePreview src={`/dl/${token}?f=${preview.id}&mode=preview`} kind={preview.previewKind} name={preview.name} size={preview.size} extension={preview.name.split(".").pop() ?? ""} />}
      </Modal>
    </>
  );
}
