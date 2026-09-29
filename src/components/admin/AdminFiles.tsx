"use client";

import { Ban, RefreshCw, RotateCcw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useResource } from "@/lib/useResource";
import { ScanBadge } from "@/components/share/Bits";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Field, Input, Select } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, Skeleton, Spinner } from "@/components/ui/Feedback";
import { FileIcon } from "@/components/ui/FileIcon";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatBytes, formatDateTime, timeAgo } from "@/lib/format";
import type { FileDto } from "@/lib/types";
import { useCursorList } from "./useCursorList";

type Row = FileDto & { ownerEmail: string | null };

interface Detail {
  file: Row;
  storageKey: string;
  scans: Array<{ id: string; provider: string; status: string; signature: string | null; details: string | null; startedAt: string; finishedAt: string | null }>;
  reports: Array<{ id: string; category: string; status: string; createdAt: string }>;
  shareCount: number;
}

function StatusBadge({ status }: { status: FileDto["status"] }) {
  const map = { available: "success", scanning: "accent", processing: "accent", quarantined: "danger", failed: "warning" } as const;
  return <Badge tone={map[status]}>{status}</Badge>;
}

export function AdminFiles() {
  const sp = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [debounced, setDebounced] = useState(q.trim());
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [scan, setScan] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = useCursorList<Row>("/api/v1/admin/files", { q: debounced || undefined, status: status || undefined, scan: scan || undefined });

  const detailRes = useResource<Detail | null>(`admin-file-${detailId}`, (signal) => (detailId ? api<Detail>(`/api/v1/admin/files/${detailId}`, { signal }) : Promise.resolve(null)));
  const detail = detailId ? detailRes.data : null;

  const act = async (action: "quarantine" | "release" | "delete" | "rescan") => {
    if (!detail) return;
    if (action === "delete" && !(await confirm({ title: "Delete this file permanently?", description: "The file and its share links are removed from storage. This can't be undone.", confirmLabel: "Delete file", tone: "danger" }))) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/files/${detail.file.id}`, { method: "POST", body: { action, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast.success(action === "delete" ? "File deleted" : action === "quarantine" ? "File quarantined" : action === "release" ? "File released" : "Rescan queued");
      setNote("");
      list.reload();
      if (action === "delete") setDetailId(null);
      else detailRes.reload();
    } catch (err) {
      toast.error("Action failed", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <label htmlFor="admin-file-search" className="sr-only">
            Search files
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input id="admin-file-search" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, owner email, SHA-256 or file id" />
        </div>
        <Select aria-label="Status" className="h-9 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {["available", "scanning", "processing", "quarantined", "failed"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select aria-label="Scan result" className="h-9 w-auto" value={scan} onChange={(e) => setScan(e.target.value)}>
          <option value="">Any scan result</option>
          {["pending", "scanning", "clean", "infected", "error", "not_scanned"].map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </Select>
      </div>
      {list.error && <ErrorNotice className="mb-3">{list.error}</ErrorNotice>}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {!list.items ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : list.items.length === 0 ? (
          <EmptyState icon={<Search />} title="No files match" description="Adjust the filters or search." />
        ) : (
          <div role="region" aria-label="Files" tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-[50rem] text-left text-[13px]">
              <thead className="border-b border-line text-xs text-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Scan</th>
                  <th className="px-3 py-2 font-medium">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.items.map((f) => (
                  <tr key={f.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setDetailId(f.id)}>
                    <td className="px-4 py-2">
                      <button type="button" className="flex items-center gap-3 text-left" onClick={() => setDetailId(f.id)}>
                        <FileIcon category={f.category} />
                        <span className="min-w-0 max-w-64 truncate font-medium hover:underline" title={f.name}>
                          {f.name}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted">{f.ownerEmail ?? "—"}</td>
                    <td className="px-3 py-2 tnum">{formatBytes(f.size)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={f.status} />
                    </td>
                    <td className="px-3 py-2">
                      <ScanBadge scanStatus={f.scanStatus} status={f.status} />
                    </td>
                    <td className="px-3 py-2 text-muted">{timeAgo(f.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.hasMore && (
          <div className="flex justify-center border-t border-line p-3">
            <Button onClick={list.loadMore} loading={list.loadingMore}>
              Load more
            </Button>
          </div>
        )}
      </div>

      <Modal open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)} title="File record" description="Metadata only — administrators can't read file contents from here." size="xl">
        {detailRes.error ? (
          <ErrorNotice>{detailRes.error}</ErrorNotice>
        ) : !detail ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="divide-y divide-line rounded-lg border border-line text-[13px]">
              {[
                ["Name", detail.file.name],
                ["Owner", detail.file.owner ? `${detail.file.owner.name} (${detail.file.ownerEmail})` : "—"],
                ["Type", `${detail.file.mime} · .${detail.file.extension || "—"}`],
                ["Size", formatBytes(detail.file.size)],
                ["SHA-256", detail.file.sha256],
                ["Status", `${detail.file.status}${detail.file.quarantineNote ? ` — ${detail.file.quarantineNote}` : ""}`],
                ["Uploaded", formatDateTime(detail.file.createdAt)],
                ["Expires", detail.file.expiresAt ? formatDateTime(detail.file.expiresAt) : "Never"],
                ["Downloads", detail.file.downloadCount.toLocaleString("en-US")],
                ["Share links", String(detail.shareCount)],
                ["Storage key", detail.storageKey],
                ["File id", detail.file.id],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[7rem_1fr] gap-3 px-3 py-2">
                  <dt className="text-subtle">{k}</dt>
                  <dd className="break-all">{k === "SHA-256" || k === "Storage key" || k === "File id" ? <code className="font-mono text-xs">{v}</code> : v}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-subtle uppercase">Scan history</h3>
              {detail.scans.length === 0 ? (
                <p className="text-[13px] text-muted">No scans have run for this file{detail.file.scanStatus === "not_scanned" ? " (no scanner is configured)" : ""}.</p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line text-[13px]">
                  {detail.scans.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>
                        <strong className="font-medium">{s.provider}</strong> · {s.status}
                        {s.signature ? ` (${s.signature})` : ""}
                      </span>
                      <span className="text-xs text-muted">{formatDateTime(s.startedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {detail.reports.length > 0 && (
              <p className="text-[13px] text-muted">
                {detail.reports.length} abuse report{detail.reports.length === 1 ? "" : "s"} on this file ({detail.reports.filter((r) => r.status === "open" || r.status === "reviewing").length} pending).
              </p>
            )}
            <Field label="Note for the owner" optional hint="Shown with the quarantine notification.">
              {(p) => <Input {...p} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <div className="flex flex-wrap gap-2">
              {detail.file.status === "quarantined" ? (
                <Button onClick={() => act("release")} loading={busy} icon={<RotateCcw className="size-4" aria-hidden />}>
                  Release from quarantine
                </Button>
              ) : (
                <Button onClick={() => act("quarantine")} loading={busy} icon={<Ban className="size-4" aria-hidden />}>
                  Quarantine
                </Button>
              )}
              <Button onClick={() => act("rescan")} disabled={busy} icon={<RefreshCw className="size-4" aria-hidden />}>
                Rescan
              </Button>
              <Button variant="danger" onClick={() => act("delete")} disabled={busy} icon={<Trash2 className="size-4" aria-hidden />}>
                Delete file
              </Button>
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-subtle">
                <ShieldCheck className="size-3.5" aria-hidden /> Actions are recorded in the audit log.
              </span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
