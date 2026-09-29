"use client";

import { History, X } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import { dropInterrupted, fingerprint, listInterrupted } from "@/lib/upload/engine";
import { useUploadManager, useUploads } from "./UploadProvider";

const subscribe = (fn: () => void) => {
  window.addEventListener("storage", fn);
  window.addEventListener("cairn:uploads-store", fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener("cairn:uploads-store", fn);
  };
};

/**
 * Uploads that were cut off by a reload or a closed tab. The browser can't keep the file itself, so the person picks
 * the same file again and the server tells us which chunks it already has: only the missing ones are sent.
 */
export function InterruptedUploads({ requestToken }: { requestToken?: string }) {
  const manager = useUploadManager();
  const items = useUploads();
  const picker = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(listInterrupted(new Set(items.map((i) => fingerprint(i.file))))),
    () => "[]",
  );
  const entries = (JSON.parse(snapshot) as ReturnType<typeof listInterrupted>).filter((e) => (e.requestToken ?? undefined) === requestToken);
  if (!entries.length) return null;

  const discard = async (e: (typeof entries)[number]) => {
    const path = e.requestToken ? "/api/v1/public/uploads" : "/api/v1/uploads";
    await api(`${path}/${e.uploadId}`, { method: "DELETE", headers: e.uploadKey ? { "x-upload-key": e.uploadKey } : undefined }).catch(() => undefined);
    dropInterrupted(e.fingerprint);
    window.dispatchEvent(new Event("cairn:uploads-store"));
  };

  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-[13px]">
      <p className="flex items-center gap-2 font-medium text-warning">
        <History className="size-4" aria-hidden /> {entries.length === 1 ? "An upload was interrupted" : `${entries.length} uploads were interrupted`}
      </p>
      <p className="mt-1 text-xs text-muted">Choose the same file again and it continues from where it stopped. Nothing already sent is uploaded twice.</p>
      <input
        ref={picker}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          const entry = entries.find((x) => x.fingerprint === target);
          if (file && entry) manager.add([file], { ...(entry.requestToken ? { request: { token: entry.requestToken } } : {}), folderId: entry.folderId, share: false });
          e.target.value = "";
          setTarget(null);
        }}
      />
      <ul className="mt-2 divide-y divide-warning/20">
        {entries.map((e) => (
          <li key={e.fingerprint} className="flex items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1 truncate" title={e.name}>
              {e.name} <span className="text-xs text-subtle tnum">({formatBytes(e.size)})</span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setTarget(e.fingerprint);
                picker.current?.click();
              }}
            >
              Choose file to resume
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Discard interrupted upload of ${e.name}`} onClick={() => void discard(e)}>
              <X className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
