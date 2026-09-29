"use client";

import { KeyRound, Pencil, Plus, RotateCw, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FeatureGate } from "@/components/common/Upgrade";
import { useCan, useHasFeature } from "@/components/layout/AccountContext";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { CopyButton } from "@/components/ui/CopyButton";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, Skeleton, Spinner } from "@/components/ui/Feedback";
import { Drawer, Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { EVENTS, EVENT_TYPES, type EventType } from "@/config/events";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { DeliveryDto, WebhookDto } from "@/server/services/webhooks";

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { success: "success", failed: "danger", retrying: "warning", pending: "neutral" };

function SecretReveal({ secret, onClose, title }: { secret: string; onClose: () => void; title: string }) {
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} description="Copy it now. For your security it's shown only once." size="md">
      <div className="space-y-3">
        <p className="rounded-md bg-surface-2 p-3 font-mono text-[13px] break-all select-all">{secret}</p>
        <p className="text-xs text-muted">
          Every delivery carries an <code className="font-mono">X-Cairn-Signature</code> header: <code className="font-mono">t=&lt;timestamp&gt;,v1=&lt;HMAC-SHA256 of &quot;timestamp.body&quot;&gt;</code>. Verify it and reject old timestamps. See{" "}
          <Link href="/developer/docs" className="text-accent hover:underline">
            the docs
          </Link>
          .
        </p>
        <div className="flex justify-end gap-2">
          <CopyButton value={secret} label="Copy secret" successMessage="Secret copied" />
          <Button variant="primary" onClick={onClose}>
            I&apos;ve saved it
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function WebhookDialog({ existing, onClose, onSaved }: { existing: WebhookDto | null; onClose: () => void; onSaved: (secret?: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [all, setAll] = useState(existing ? existing.events.includes("*") : false);
  const [events, setEvents] = useState<Set<string>>(new Set(existing?.events.filter((e) => e !== "*") ?? ["file.uploaded"]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), url: url.trim(), events: all ? ["*"] : [...events] };
      if (existing) {
        await api(`/api/v1/webhooks/${existing.id}`, { method: "PATCH", body });
        toast.success("Webhook updated");
        onSaved();
      } else {
        const res = await api<{ secret: string }>("/api/v1/webhooks", { method: "POST", body });
        onSaved(res.secret);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={existing ? "Edit webhook" : "New webhook"} description="We POST a signed JSON event to your URL. Failed deliveries are retried with backoff." size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">{(p) => <Input {...p} value={name} maxLength={80} required autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Ingest pipeline" />}</Field>
          <Field label="Endpoint URL" hint="Must be https and reachable from the internet.">
            {(p) => <Input {...p} type="url" value={url} required placeholder="https://example.com/hooks/cairn" onChange={(e) => setUrl(e.target.value)} />}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Events</legend>
          <Checkbox label="Send every event (including ones added in the future)" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {!all && (
            <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {EVENT_TYPES.map((t: EventType) => (
                <Checkbox
                  key={t}
                  label={
                    <span>
                      {EVENTS[t].label} <code className="ml-1 font-mono text-[11px] text-subtle">{t}</code>
                    </span>
                  }
                  checked={events.has(t)}
                  onChange={(e) =>
                    setEvents((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(t);
                      else n.delete(t);
                      return n;
                    })
                  }
                />
              ))}
            </div>
          )}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !url.trim() || (!all && events.size === 0)}>
            {existing ? "Save changes" : "Create webhook"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type DeliveryDetail = DeliveryDto & { payload: unknown; responseBody: string | null };

function Deliveries({ webhook }: { webhook: WebhookDto }) {
  const toast = useToast();
  const res = useResource<{ items: DeliveryDto[] }>(`deliveries:${webhook.id}`, (signal) => api<{ items: DeliveryDto[] }>(`/api/v1/webhooks/${webhook.id}/deliveries?limit=50`, { signal }));
  const [open, setOpen] = useState<string | null>(null);
  const detail = useResource<DeliveryDetail | null>(`delivery:${webhook.id}:${open}`, async (signal) => (open ? (await api<{ delivery: DeliveryDetail }>(`/api/v1/webhooks/${webhook.id}/deliveries/${open}`, { signal })).delivery : null));
  const [busy, setBusy] = useState<string | null>(null);

  const replay = async (d: DeliveryDto) => {
    setBusy(d.id);
    try {
      const { delivery } = await api<{ delivery: DeliveryDto }>(`/api/v1/webhooks/${webhook.id}/deliveries/${d.id}`, { method: "POST" });
      toast[delivery.status === "success" ? "success" : "error"](delivery.status === "success" ? "Delivered" : "Delivery failed", delivery.error ?? undefined);
      res.reload();
    } catch (err) {
      toast.error("Couldn't replay", errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data)
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  if (!res.data.items.length) return <p className="text-[13px] text-muted">No deliveries yet. Send a test event, or wait for a matching event to happen.</p>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {res.data.items.map((d) => (
        <li key={d.id} className="px-3 py-2.5 text-[13px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.status}</Badge>
            <code className="font-mono text-xs">{d.event}</code>
            {d.responseCode != null && <span className="text-xs text-muted tnum">HTTP {d.responseCode}</span>}
            {d.latencyMs != null && <span className="text-xs text-subtle tnum">{d.latencyMs} ms</span>}
            {d.attempts > 1 && <span className="text-xs text-subtle">{d.attempts} attempts</span>}
            <time className="ml-auto text-xs text-subtle tnum" dateTime={d.createdAt} title={formatDateTime(d.createdAt)}>
              {timeAgo(d.createdAt)}
            </time>
          </div>
          {d.error && <p className="mt-1 text-xs text-danger">{d.error}</p>}
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" variant="ghost" aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? null : d.id)}>
              {open === d.id ? "Hide payload" : "Payload"}
            </Button>
            <Button size="sm" variant="ghost" loading={busy === d.id} onClick={() => replay(d)} icon={<RotateCw className="size-3.5" aria-hidden />}>
              Replay
            </Button>
          </div>
          {open === d.id && (
            <div className="mt-2">
              {detail.data ? (
                <>
                  <pre className="max-h-64 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-xs">{JSON.stringify(detail.data.payload, null, 2)}</pre>
                  {detail.data.responseBody && (
                    <>
                      <p className="mt-2 text-xs font-medium text-muted">Your server responded</p>
                      <pre className="max-h-32 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap">{detail.data.responseBody}</pre>
                    </>
                  )}
                </>
              ) : (
                <Spinner />
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function WebhooksManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const can = useCan("manage");
  const enabled = useHasFeature("webhooks");
  const res = useResource<{ items: WebhookDto[] }>("webhooks", (signal) => api<{ items: WebhookDto[] }>("/api/v1/webhooks", { signal }));
  const [dialog, setDialog] = useState<{ existing: WebhookDto | null } | null>(null);
  const [secret, setSecret] = useState<{ value: string; title: string } | null>(null);
  const [log, setLog] = useState<WebhookDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const items = res.data?.items ?? null;

  const test = async (w: WebhookDto) => {
    setBusy(`test:${w.id}`);
    try {
      const { delivery } = await api<{ delivery: DeliveryDto }>(`/api/v1/webhooks/${w.id}/test`, { method: "POST" });
      if (delivery.status === "success") toast.success("Test delivered", `Your server answered HTTP ${delivery.responseCode}.`);
      else toast.error("Test failed", delivery.error ?? `HTTP ${delivery.responseCode ?? "—"}`);
      res.reload();
    } catch (err) {
      toast.error("Couldn't send the test", errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const rotate = async (w: WebhookDto) => {
    if (!(await confirm({ title: "Rotate the signing secret?", description: "The old secret stops working immediately. Update your server with the new one right away.", confirmLabel: "Rotate secret", tone: "danger" }))) return;
    try {
      const res2 = await api<{ secret: string }>(`/api/v1/webhooks/${w.id}/secret`, { method: "POST" });
      setSecret({ value: res2.secret, title: `New secret for ${w.name}` });
    } catch (err) {
      toast.error("Couldn't rotate the secret", errorMessage(err));
    }
  };
  const toggle = async (w: WebhookDto) => {
    try {
      await api(`/api/v1/webhooks/${w.id}`, { method: "PATCH", body: { enabled: !w.enabled } });
      res.reload();
    } catch (err) {
      toast.error("Couldn't update the webhook", errorMessage(err));
    }
  };
  const remove = async (w: WebhookDto) => {
    if (!(await confirm({ title: `Delete “${w.name}”?`, description: "Its delivery history is deleted with it.", confirmLabel: "Delete", tone: "danger" }))) return;
    try {
      await api(`/api/v1/webhooks/${w.id}`, { method: "DELETE" });
      toast.success("Webhook deleted");
      res.reload();
    } catch (err) {
      toast.error("Couldn't delete the webhook", errorMessage(err));
    }
  };

  if (!enabled) return <FeatureGate feature="webhooks">{null}</FeatureGate>;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[13px] text-muted">Get a signed HTTP call whenever something happens in this workspace. Endpoints that keep failing are switched off automatically, and you can replay any delivery.</p>
        {can && (
          <Button variant="primary" onClick={() => setDialog({ existing: null })} icon={<Plus className="size-4" aria-hidden />}>
            New webhook
          </Button>
        )}
      </div>
      {res.error && <ErrorNotice className="mb-3">{res.error}</ErrorNotice>}
      {!items && !res.error ? (
        <Skeleton className="h-28" />
      ) : items && items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<WebhookIcon />} title="No webhooks yet" description="Connect Cairn to your own services: process uploads, sync shares, or audit downloads." />
        </div>
      ) : (
        <ul className="space-y-3">
          {items?.map((w) => (
            <li key={w.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {w.name}
                    <Badge tone={w.enabled ? "success" : "warning"}>{w.enabled ? "Active" : w.failureCount >= 25 ? "Disabled after failures" : "Paused"}</Badge>
                  </h3>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted">{w.url}</p>
                  <p className="mt-1.5 text-xs text-subtle">
                    {w.events.includes("*") ? "All events" : `${w.events.length} ${w.events.length === 1 ? "event" : "events"}: ${w.events.slice(0, 3).join(", ")}${w.events.length > 3 ? "…" : ""}`}
                    {w.lastDeliveryAt && ` · last delivery ${timeAgo(w.lastDeliveryAt)}`}
                    {w.failureCount > 0 && ` · ${w.failureCount} consecutive ${w.failureCount === 1 ? "failure" : "failures"}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" onClick={() => setLog(w)}>
                    Deliveries
                  </Button>
                  {can && (
                    <>
                      <Button size="sm" loading={busy === `test:${w.id}`} disabled={!w.enabled} onClick={() => test(w)} icon={<Send className="size-4" aria-hidden />}>
                        Send test
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Rotate secret for ${w.name}`} onClick={() => rotate(w)}>
                        <KeyRound className="size-4" aria-hidden />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${w.name}`} onClick={() => setDialog({ existing: w })}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle(w)}>
                        {w.enabled ? "Pause" : "Resume"}
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${w.name}`} onClick={() => remove(w)}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {dialog && (
        <WebhookDialog
          existing={dialog.existing}
          onClose={() => setDialog(null)}
          onSaved={(s) => {
            res.reload();
            if (s) setSecret({ value: s, title: "Your signing secret" });
          }}
        />
      )}
      {secret && <SecretReveal secret={secret.value} title={secret.title} onClose={() => setSecret(null)} />}
      <Drawer open={!!log} onOpenChange={(o) => !o && setLog(null)} title={log ? `Deliveries: ${log.name}` : "Deliveries"} width="w-full sm:w-[36rem]">
        {log && (
          <div className="p-4">
            <Deliveries webhook={log} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
