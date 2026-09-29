"use client";

import { Biohazard, Inbox } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { TICKET_CATEGORY_LABELS, TICKET_TONE } from "@/components/support/Support";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatBytes, formatDateTime, timeAgo } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { TicketDto, TicketMessageDto } from "@/server/services/support";
import { useCursorList } from "./useCursorList";

interface QItem {
  id: string;
  fileId: string;
  fileName: string;
  size: number;
  mime: string;
  sha256: string;
  ownerEmail: string;
  reason: string;
  source: string;
  signature: string | null;
  state: "pending" | "confirmed" | "released";
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

const SOURCE_LABEL: Record<string, string> = { scanner: "Malware scanner", admin: "Administrator", report: "Abuse report", rule: "File-type rule" };

export function AdminQuarantine() {
  const toast = useToast();
  const [state, setState] = useState("pending");
  const list = useCursorList<QItem>("/api/v1/admin/quarantine", { state });
  const [target, setTarget] = useState<{ item: QItem; action: "release" | "confirm" | "delete" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/admin/quarantine/${target.item.fileId}`, { method: "POST", body: { action: target.action, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast.success(target.action === "release" ? "File released" : target.action === "confirm" ? "Marked as malicious" : "File deleted");
      setTarget(null);
      setNote("");
      list.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copy: Record<string, { title: string; body: string; cta: string; variant: "primary" | "danger" }> = {
    release: { title: "Release this file?", body: "It becomes available again and its owner is notified. Only release files you have verified are safe.", cta: "Release file", variant: "primary" },
    confirm: { title: "Confirm as malicious?", body: "The file stays blocked, its links stay revoked, and it can no longer be released.", cta: "Confirm malicious", variant: "danger" },
    delete: { title: "Delete this file permanently?", body: "The file and its storage are removed. This can't be undone.", cta: "Delete permanently", variant: "danger" },
  };

  return (
    <div>
      <div role="tablist" aria-label="Review state" className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5">
        {["pending", "confirmed", "released", "all"].map((s) => (
          <button key={s} role="tab" type="button" aria-selected={state === s} onClick={() => setState(s)} className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium capitalize", state === s ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}>
            {s}
          </button>
        ))}
      </div>
      {list.error && <ErrorNotice className="mb-3">{list.error}</ErrorNotice>}
      {!list.items ? (
        <Skeleton className="h-32" />
      ) : list.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<Biohazard />} title={state === "pending" ? "Nothing waiting for review" : "Nothing here"} description="Files blocked by the scanner, a file-type rule, an abuse report or an administrator show up here." />
        </div>
      ) : (
        <ul className="space-y-3">
          {list.items.map((q) => (
            <li key={q.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={q.state === "pending" ? "warning" : q.state === "confirmed" ? "danger" : "success"}>{q.state}</Badge>
                    <span className="truncate text-[13px] font-medium">{q.fileName}</span>
                    <span className="text-xs text-subtle tnum">{formatBytes(q.size)}</span>
                  </div>
                  <p className="mt-1.5 text-[13px]">{q.reason}</p>
                  <p className="mt-1 text-xs text-muted">
                    {SOURCE_LABEL[q.source] ?? q.source}
                    {q.signature && <> · signature <code className="font-mono">{q.signature}</code></>} · owner {q.ownerEmail} · {timeAgo(q.createdAt)}
                    {q.reviewedAt && ` · reviewed ${formatDateTime(q.reviewedAt)}`}
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px] text-subtle" title={q.sha256}>
                    {q.mime} · SHA-256 {q.sha256}
                  </p>
                  {q.note && <p className="mt-1 text-xs text-muted">Note: {q.note}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {q.state === "pending" && (
                    <Button size="sm" onClick={() => setTarget({ item: q, action: "release" })}>
                      Release
                    </Button>
                  )}
                  {q.state === "pending" && (
                    <Button size="sm" variant="danger-outline" onClick={() => setTarget({ item: q, action: "confirm" })}>
                      Confirm malicious
                    </Button>
                  )}
                  {q.state !== "released" && (
                    <Button size="sm" variant="danger-outline" onClick={() => setTarget({ item: q, action: "delete" })}>
                      Delete
                    </Button>
                  )}
                </div>
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
      <Modal open={!!target} onOpenChange={(o) => !o && setTarget(null)} title={target ? copy[target.action].title : ""} description={target?.item.fileName} size="sm">
        {target && (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-[13px] text-muted">{copy[target.action].body}</p>
            {error && <ErrorNotice>{error}</ErrorNotice>}
            <Field label="Note" optional>
              {(p) => <Input {...p} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setTarget(null)}>Cancel</Button>
              <Button type="submit" variant={copy[target.action].variant} loading={busy}>
                {copy[target.action].cta}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

export function AdminTickets() {
  const [status, setStatus] = useState("active");
  const list = useCursorList<TicketDto>("/api/v1/admin/tickets", { status });
  return (
    <div>
      <div role="tablist" aria-label="Ticket status" className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5">
        {["active", "open", "answered", "closed"].map((s) => (
          <button key={s} role="tab" type="button" aria-selected={status === s} onClick={() => setStatus(s)} className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium capitalize", status === s ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}>
            {s === "active" ? "Needs attention" : s}
          </button>
        ))}
      </div>
      {list.error && <ErrorNotice className="mb-3">{list.error}</ErrorNotice>}
      {!list.items ? (
        <Skeleton className="h-24" />
      ) : list.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<Inbox />} title="No tickets" />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {list.items.map((t) => (
            <li key={t.id}>
              <Link href={`/admin/tickets/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2">
                <Badge tone={TICKET_TONE[t.status] ?? "neutral"}>{t.status}</Badge>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.subject}</span>
                <span className="text-xs text-subtle">{t.requester?.email}</span>
                <span className="text-xs text-subtle">{TICKET_CATEGORY_LABELS[t.category] ?? t.category}</span>
                <time className="text-xs text-subtle" dateTime={t.updatedAt}>
                  {timeAgo(t.updatedAt)}
                </time>
              </Link>
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
    </div>
  );
}

interface Thread {
  ticket: TicketDto;
  messages: TicketMessageDto[];
}

export function AdminTicketThread({ id }: { id: string }) {
  const toast = useToast();
  const res = useResource<Thread>(`admin-ticket:${id}`, (signal) => api<Thread>(`/api/v1/admin/tickets/${id}`, { signal }));
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      res.mutate(await api<Thread>(`/api/v1/admin/tickets/${id}`, { method: "POST", body: { body: reply.trim() } }));
      setReply("");
      toast.success("Reply sent");
    } catch (err) {
      toast.error("Couldn't send the reply", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (status: string) => {
    try {
      await api(`/api/v1/admin/tickets/${id}`, { method: "PATCH", body: { status } });
      res.reload();
    } catch (err) {
      toast.error("Couldn't change the status", errorMessage(err));
    }
  };

  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Skeleton className="h-64" />;
  const { ticket, messages } = res.data;
  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={TICKET_TONE[ticket.status] ?? "neutral"}>{ticket.status}</Badge>
        <span className="text-xs text-subtle">
          {TICKET_CATEGORY_LABELS[ticket.category] ?? ticket.category} · {ticket.requester?.name} ({ticket.requester?.email}) · opened {formatDateTime(ticket.createdAt)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="sr-only" htmlFor="ticket-status">
            Status
          </label>
          <Select id="ticket-status" value={ticket.status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-32 text-[13px]">
            <option value="open">Open</option>
            <option value="answered">Answered</option>
            <option value="closed">Closed</option>
          </Select>
        </div>
      </div>
      <ol className="space-y-3">
        {messages.map((m) => (
          <li key={m.id} className={cn("rounded-lg border p-4", m.staff ? "border-accent-line bg-accent-soft/40" : "border-line bg-surface")}>
            <p className="mb-1 flex items-center gap-2 text-xs text-subtle">
              <span className="font-medium text-fg">{m.staff ? "Support" : (m.author ?? ticket.requester?.name)}</span>
              <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
            </p>
            <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="mt-4 space-y-3">
        <Field label="Reply to the user">{(p) => <Textarea {...p} rows={4} maxLength={5000} required value={reply} onChange={(e) => setReply(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" loading={busy} disabled={!reply.trim()}>
          Send reply
        </Button>
      </form>
    </div>
  );
}
