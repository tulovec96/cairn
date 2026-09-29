"use client";

import { LifeBuoy, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { TicketDto, TicketMessageDto } from "@/server/services/support";

export const TICKET_CATEGORY_LABELS: Record<string, string> = {
  account: "Account or sign-in",
  billing: "Plans and billing",
  bug: "Something is broken",
  feature: "Feature request",
  abuse: "Report abuse",
  other: "Something else",
};

export const TICKET_TONE: Record<string, "success" | "warning" | "neutral" | "accent"> = { open: "warning", answered: "success", closed: "neutral" };

function NewTicketDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [category, setCategory] = useState("bug");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { ticket } = await api<{ ticket: TicketDto }>("/api/v1/support/tickets", { method: "POST", body: { category, subject: subject.trim(), body: body.trim() } });
      toast.success("Ticket opened");
      router.push(`/support/${ticket.id}`);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFields(err.fieldErrors());
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Contact support" description="A person reads every ticket. Include what you were doing and what you expected." size="md">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Field label="What's it about?">
          {(p) => (
            <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(TICKET_CATEGORY_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Subject" error={fields.subject}>
          {(p) => <Input {...p} value={subject} minLength={3} maxLength={150} required autoFocus onChange={(e) => setSubject(e.target.value)} />}
        </Field>
        <Field label="Details" error={fields.body} hint={`${body.length}/5000`}>
          {(p) => <Textarea {...p} rows={6} minLength={10} maxLength={5000} required value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={subject.trim().length < 3 || body.trim().length < 10}>
            Send
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function SupportCenter() {
  const res = useResource<{ items: TicketDto[] }>("tickets", (signal) => api<{ items: TicketDto[] }>("/api/v1/support/tickets", { signal }));
  const [creating, setCreating] = useState(false);
  const items = res.data?.items ?? null;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[13px] text-muted">
          Looking for a quick answer? Try the{" "}
          <Link href="/help" className="text-accent hover:underline">
            help center
          </Link>{" "}
          or the{" "}
          <Link href="/faq" className="text-accent hover:underline">
            FAQ
          </Link>{" "}
          first.
        </p>
        <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" aria-hidden />}>
          New ticket
        </Button>
      </div>
      {res.error && <ErrorNotice className="mb-3">{res.error}</ErrorNotice>}
      {!items && !res.error ? (
        <Skeleton className="h-24" />
      ) : items && items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<LifeBuoy />} title="No tickets" description="When you contact support, the conversation lives here." />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {items?.map((t) => (
            <li key={t.id}>
              <Link href={`/support/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2">
                <Badge tone={TICKET_TONE[t.status] ?? "neutral"}>{t.status}</Badge>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.subject}</span>
                <span className="text-xs text-subtle">{TICKET_CATEGORY_LABELS[t.category] ?? t.category}</span>
                <time className="text-xs text-subtle" dateTime={t.updatedAt}>
                  {timeAgo(t.updatedAt)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewTicketDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

interface ThreadPayload {
  ticket: TicketDto;
  messages: TicketMessageDto[];
}

/** One conversation. `base` is the API path so the same view serves customers and (with staff endpoints) admins. */
export function TicketThread({ id, base = "/api/v1/support/tickets", staffView = false }: { id: string; base?: string; staffView?: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const res = useResource<ThreadPayload>(`ticket:${base}:${id}`, (signal) => api<ThreadPayload>(`${base}/${id}`, { signal }));
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await api<ThreadPayload>(`${base}/${id}`, { method: "POST", body: { body: reply.trim() } });
      res.mutate(next);
      setReply("");
    } catch (err) {
      toast.error("Couldn't send your reply", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    if (!(await confirm({ title: "Close this ticket?", description: staffView ? undefined : "You can open a new one any time.", confirmLabel: "Close ticket" }))) return;
    try {
      await api(`${base}/${id}`, { method: "DELETE" });
      res.reload();
    } catch (err) {
      toast.error("Couldn't close the ticket", errorMessage(err));
    }
  };

  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Skeleton className="h-64" />;
  const { ticket, messages } = res.data;
  const closed = ticket.status === "closed";
  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={TICKET_TONE[ticket.status] ?? "neutral"}>{ticket.status}</Badge>
        <span className="text-xs text-subtle">
          {TICKET_CATEGORY_LABELS[ticket.category] ?? ticket.category} · opened {formatDateTime(ticket.createdAt)}
          {ticket.requester && ` · ${ticket.requester.name} (${ticket.requester.email})`}
        </span>
        {!closed && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={close}>
            Close ticket
          </Button>
        )}
      </div>
      <ol className="space-y-3">
        {messages.map((m) => (
          <li key={m.id} className={cn("rounded-lg border p-4", m.staff ? "border-accent-line bg-accent-soft/40" : "border-line bg-surface")}>
            <p className="mb-1 flex items-center gap-2 text-xs text-subtle">
              <span className="font-medium text-fg">{m.staff ? "Support" : (m.author ?? "You")}</span>
              <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
            </p>
            <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      {closed ? (
        <p className="mt-4 text-[13px] text-muted">
          This ticket is closed.{" "}
          {!staffView && (
            <Link href="/support" className="text-accent hover:underline">
              Open a new one
            </Link>
          )}
        </p>
      ) : (
        <form onSubmit={send} className="mt-4 space-y-3">
          <Field label="Reply">{(p) => <Textarea {...p} rows={4} maxLength={5000} required value={reply} onChange={(e) => setReply(e.target.value)} />}</Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!reply.trim()} icon={<Send className="size-4" aria-hidden />}>
            Send reply
          </Button>
        </form>
      )}
    </div>
  );
}
