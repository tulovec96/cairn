"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { FeatureGate } from "@/components/common/Upgrade";
import { useAccount, useCan, useHasFeature } from "@/components/layout/AccountContext";
import { FolderSelect } from "@/components/files/FolderSelect";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Badge, ErrorNotice, ProgressBar, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { ImportDto } from "@/server/services/transfer";

const TONE: Record<string, "success" | "danger" | "accent" | "neutral"> = { done: "success", failed: "danger", running: "accent", queued: "neutral" };

export function ImportManager() {
  const toast = useToast();
  const enabled = useHasFeature("urlImport");
  const canWrite = useCan("write");
  const { workspace } = useAccount();
  const res = useResource<{ items: ImportDto[] }>("imports", (signal) => api<{ items: ImportDto[] }>("/api/v1/imports", { signal }));
  const [url, setUrl] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = res.data?.items ?? null;
  const active = !!items?.some((i) => i.status === "queued" || i.status === "running");
  const { reload } = res;

  useEffect(() => {
    if (!active) return;
    const t = setInterval(reload, 2500);
    return () => clearInterval(t);
  }, [active, reload]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/imports", { method: "POST", body: { url: url.trim(), folderId } });
      toast.success("Import started");
      setUrl("");
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return <FeatureGate feature="urlImport">{null}</FeatureGate>;

  return (
    <div className="max-w-3xl">
      <p className="mb-4 text-[13px] text-muted">Paste a public web address and we&apos;ll fetch the file straight into your storage. Only public http(s) addresses work; private and internal networks are refused, and the file is scanned like any upload. It counts toward your storage and file-size limits.</p>
      {workspace.orgId && <ErrorNotice tone="info" className="mb-4">URL imports go to your personal files. Switch to your personal workspace to use them.</ErrorNotice>}
      <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-surface p-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Field label="File URL">{(p) => <Input {...p} type="url" required placeholder="https://example.com/archive.zip" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
        <Field label="Save into">{(p) => <FolderSelect id={p.id} value={folderId} onChange={setFolderId} />}</Field>
        <Button type="submit" variant="primary" loading={busy} disabled={!url.trim() || !canWrite || !!workspace.orgId} icon={<Download className="size-4" aria-hidden />}>
          Import
        </Button>
      </form>

      <h2 className="mt-8 mb-2 text-sm font-semibold">Recent imports</h2>
      {res.error && <ErrorNotice>{res.error}</ErrorNotice>}
      {!items && !res.error ? (
        <Skeleton className="h-16" />
      ) : items && items.length === 0 ? (
        <p className="text-[13px] text-muted">Nothing imported yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {items?.map((i) => (
            <li key={i.id} className="px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Badge tone={TONE[i.status] ?? "neutral"}>{i.status}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={i.url}>
                  {i.url}
                </span>
                <time className="text-xs text-subtle" dateTime={i.createdAt}>
                  {timeAgo(i.createdAt)}
                </time>
                {i.fileId && (
                  <Link href={`/file/${i.fileId}`} className="font-medium text-accent hover:underline">
                    Open file
                  </Link>
                )}
              </div>
              {i.status === "running" && <ProgressBar value={null} className="mt-2" label="Import in progress" />}
              {i.error && <p className="mt-1 text-xs text-danger">{i.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
