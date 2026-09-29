"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatBytes, formatDateTime, timeAgo } from "@/lib/format";
import { REPORT_CATEGORIES } from "@/lib/types";
import { useCursorList } from "./useCursorList";

interface Report {
  id: string;
  category: string;
  description: string;
  contact: string | null;
  status: "open" | "reviewing" | "actioned" | "dismissed";
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  fileId: string | null;
  fileName: string;
  fileStatus: string;
  fileSize: number | null;
}

const TABS = [
  { value: "pending", label: "Pending" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
] as const;

export function AdminReports() {
  const toast = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("pending");
  const list = useCursorList<Report>("/api/v1/admin/reports", { status: tab });
  const [target, setTarget] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStatus = async (r: Report, status: "reviewing") => {
    try {
      await api(`/api/v1/admin/reports/${r.id}`, { method: "POST", body: { status } });
      list.reload();
    } catch (err) {
      toast.error("Couldn't update the report", errorMessage(err));
    }
  };

  const resolve = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!target) return;
    const d = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/admin/reports/${target.id}`, {
        method: "POST",
        body: { status: String(d.get("outcome")), action: String(d.get("action")), ...(d.get("note") ? { note: String(d.get("note")) } : {}) },
      });
      toast.success("Report resolved");
      setTarget(null);
      list.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const label = (c: string) => REPORT_CATEGORIES.find((x) => x.value === c)?.label ?? c;

  return (
    <div>
      <div role="tablist" aria-label="Report status" className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5">
        {TABS.map((t) => (
          <button key={t.value} role="tab" type="button" aria-selected={tab === t.value} onClick={() => setTab(t.value)} className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium", tab === t.value ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}>
            {t.label}
          </button>
        ))}
      </div>
      {list.error && <ErrorNotice className="mb-3">{list.error}</ErrorNotice>}
      {!list.items ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : list.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<ShieldCheck />} title={tab === "pending" ? "No pending reports" : "Nothing here"} description={tab === "pending" ? "Abuse reports submitted from public download pages appear here for review." : undefined} />
        </div>
      ) : (
        <ul className="space-y-3">
          {list.items.map((r) => (
            <li key={r.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.category === "malware" || r.category === "illegal" ? "danger" : "warning"}>{label(r.category)}</Badge>
                    {r.status === "reviewing" && <Badge tone="accent">Reviewing</Badge>}
                    {r.status === "actioned" && <Badge tone="success">Actioned</Badge>}
                    {r.status === "dismissed" && <Badge>Dismissed</Badge>}
                    <span className="text-xs text-muted" title={formatDateTime(r.createdAt)}>
                      {timeAgo(r.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] whitespace-pre-wrap">{r.description}</p>
                  <p className="mt-2 text-xs text-muted">
                    File:{" "}
                    {r.fileId ? (
                      <Link href={`/admin/files?q=${r.fileId}`} className="font-medium text-accent hover:underline">
                        {r.fileName}
                      </Link>
                    ) : (
                      <span>{r.fileName} (deleted)</span>
                    )}
                    {r.fileSize !== null && <span className="tnum"> · {formatBytes(r.fileSize)}</span>} · status {r.fileStatus}
                    {r.contact && <> · contact {r.contact}</>}
                  </p>
                  {r.resolutionNote && <p className="mt-1 text-xs text-muted">Note: {r.resolutionNote}</p>}
                </div>
                {(r.status === "open" || r.status === "reviewing") && (
                  <div className="flex gap-2">
                    {r.status === "open" && (
                      <Button size="sm" onClick={() => setStatus(r, "reviewing")}>
                        Start review
                      </Button>
                    )}
                    <Button size="sm" variant="primary" onClick={() => setTarget(r)}>
                      Resolve…
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.hasMore && (
        <div className="mt-3 flex justify-center">
          <Button onClick={list.loadMore} loading={list.loadingMore}>
            Load more
          </Button>
        </div>
      )}

      <Modal open={!!target} onOpenChange={(o) => !o && setTarget(null)} title="Resolve report" description={target?.fileName} size="md">
        <form onSubmit={resolve} className="space-y-4">
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <Field label="Outcome">
            {(p) => (
              <Select {...p} name="outcome" defaultValue="actioned">
                <option value="actioned">Valid — action taken</option>
                <option value="dismissed">Dismiss — no violation</option>
              </Select>
            )}
          </Field>
          <Field label="Action on the file">
            {(p) => (
              <Select {...p} name="action" defaultValue="quarantine">
                <option value="none">No change to the file</option>
                <option value="quarantine">Quarantine (blocks downloads, revokes links)</option>
                <option value="delete">Delete permanently</option>
              </Select>
            )}
          </Field>
          <Field label="Internal note" optional>
            {(p) => <Input {...p} name="note" maxLength={1000} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setTarget(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>
              Resolve report
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
