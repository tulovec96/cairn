"use client";

import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { useResource } from "@/lib/useResource";

const KINDS = ["feature", "improvement", "fix", "security"] as const;

interface Entry {
  id: string;
  title: string;
  body: string;
  kind: string;
  version: string | null;
  publishedAt: string | null;
  createdAt: string;
}

function EntryDialog({ existing, onClose, onSaved }: { existing: Entry | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [kind, setKind] = useState(existing?.kind ?? "feature");
  const [version, setVersion] = useState(existing?.version ?? "");
  const [publish, setPublish] = useState(!!existing?.publishedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { title: title.trim(), body: body.trim(), kind, version: version.trim() || null, publish };
      await api(existing ? `/api/v1/admin/changelog/${existing.id}` : "/api/v1/admin/changelog", { method: existing ? "PATCH" : "POST", body: payload });
      toast.success(existing ? "Entry saved" : "Entry created");
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={existing ? "Edit entry" : "New changelog entry"} description="Published entries appear on the public changelog. Drafts stay private." size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Title" className="sm:col-span-3">{(p) => <Input {...p} value={title} minLength={3} maxLength={120} required autoFocus onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Kind">
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Version" optional>{(p) => <Input {...p} value={version} maxLength={30} placeholder="1.4.0" onChange={(e) => setVersion(e.target.value)} />}</Field>
        </div>
        <Field label="Details" hint="Plain text. Blank lines start a new paragraph.">{(p) => <Textarea {...p} rows={8} minLength={3} maxLength={8000} required value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
        <Checkbox label="Published" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={title.trim().length < 3 || body.trim().length < 3}>
            {existing ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminChangelog() {
  const toast = useToast();
  const confirm = useConfirm();
  const res = useResource<{ items: Entry[] }>("admin-changelog", (signal) => api<{ items: Entry[] }>("/api/v1/admin/changelog", { signal }));
  const [dialog, setDialog] = useState<{ existing: Entry | null } | null>(null);

  const remove = async (e: Entry) => {
    if (!(await confirm({ title: `Delete “${e.title}”?`, confirmLabel: "Delete", tone: "danger" }))) return;
    try {
      await api(`/api/v1/admin/changelog/${e.id}`, { method: "DELETE" });
      res.reload();
    } catch (err) {
      toast.error("Couldn't delete", errorMessage(err));
    }
  };
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Skeleton className="h-48" />;
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setDialog({ existing: null })} icon={<Plus className="size-4" aria-hidden />}>
          New entry
        </Button>
      </div>
      {res.data.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<Megaphone />} title="No entries yet" description="Write what changed. The public changelog only ever shows entries you publish here." />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {res.data.items.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px]">
              <Badge tone={e.publishedAt ? "success" : "neutral"}>{e.publishedAt ? "Published" : "Draft"}</Badge>
              <Badge>{e.kind}</Badge>
              <span className="min-w-0 flex-1 truncate font-medium">
                {e.version && <span className="mr-2 font-mono text-xs text-subtle">{e.version}</span>}
                {e.title}
              </span>
              <span className="text-xs text-subtle">{formatDate(e.publishedAt ?? e.createdAt)}</span>
              <Button size="icon-sm" variant="ghost" aria-label={`Edit ${e.title}`} onClick={() => setDialog({ existing: e })}>
                <Pencil className="size-4" aria-hidden />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Delete ${e.title}`} onClick={() => remove(e)}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {dialog && <EntryDialog existing={dialog.existing} onClose={() => setDialog(null)} onSaved={res.reload} />}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

interface Incident {
  id: string;
  title: string;
  body: string;
  severity: string;
  status: string;
  services: string[];
  createdAt: string;
  resolvedAt: string | null;
}

const SERVICE_OPTIONS = [
  ["database", "Database"],
  ["storage", "File storage"],
  ["jobs", "Background processing"],
  ["scanner", "Malware scanning"],
] as const;
const STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;

function IncidentDialog({ existing, onClose, onSaved }: { existing: Incident | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [severity, setSeverity] = useState(existing?.severity ?? "minor");
  const [status, setStatus] = useState(existing?.status ?? "investigating");
  const [services, setServices] = useState<Set<string>>(new Set(existing?.services ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { title: title.trim(), body: body.trim(), severity, status, services: [...services] };
      await api(existing ? `/api/v1/admin/incidents/${existing.id}` : "/api/v1/admin/incidents", { method: existing ? "PATCH" : "POST", body: payload });
      toast.success(existing ? "Incident updated" : "Incident posted");
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={existing ? "Update incident" : "Post an incident"} description="Incidents appear immediately on the public status page." size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Field label="Title">{(p) => <Input {...p} value={title} minLength={3} maxLength={150} required autoFocus onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Severity">
            {(p) => (
              <Select {...p} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="minor">Minor: degraded</option>
                <option value="major">Major: partial outage</option>
                <option value="critical">Critical: outage</option>
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(p) => (
              <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium">Affected services</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {SERVICE_OPTIONS.map(([k, l]) => (
              <Checkbox
                key={k}
                label={l}
                checked={services.has(k)}
                onChange={(e) =>
                  setServices((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(k);
                    else n.delete(k);
                    return n;
                  })
                }
              />
            ))}
          </div>
        </fieldset>
        <Field label="What's happening">{(p) => <Textarea {...p} rows={5} minLength={3} maxLength={4000} required value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={title.trim().length < 3 || body.trim().length < 3}>
            {existing ? "Update" : "Post incident"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminIncidents() {
  const res = useResource<{ items: Incident[] }>("admin-incidents", (signal) => api<{ items: Incident[] }>("/api/v1/admin/incidents", { signal }));
  const [dialog, setDialog] = useState<{ existing: Incident | null } | null>(null);
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Skeleton className="h-48" />;
  return (
    <div>
      <p className="mb-3 text-[13px] text-muted">The public status page shows real health-check results. Post an incident here to tell people what you know; nothing is invented on their behalf.</p>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setDialog({ existing: null })} icon={<Plus className="size-4" aria-hidden />}>
          Post incident
        </Button>
      </div>
      {res.data.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<Megaphone />} title="No incidents" description="That's a good thing." />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {res.data.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px]">
              <Badge tone={i.status === "resolved" ? "success" : i.severity === "critical" ? "danger" : "warning"}>{i.status}</Badge>
              <Badge>{i.severity}</Badge>
              <span className="min-w-0 flex-1 truncate font-medium">{i.title}</span>
              <span className="text-xs text-subtle">{formatDateTime(i.createdAt)}</span>
              <Button size="sm" onClick={() => setDialog({ existing: i })}>
                Update
              </Button>
            </li>
          ))}
        </ul>
      )}
      {dialog && <IncidentDialog existing={dialog.existing} onClose={() => setDialog(null)} onSaved={res.reload} />}
    </div>
  );
}
