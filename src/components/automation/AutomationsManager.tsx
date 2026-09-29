"use client";

import { ChevronDown, History, Pencil, Plus, Trash2, Workflow, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { FeatureGate } from "@/components/common/Upgrade";
import { useCan, useHasFeature } from "@/components/layout/AccountContext";
import { FolderSelect } from "@/components/files/FolderSelect";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Field, Input, Select } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { ACTION_LABELS, CONDITION_FIELDS, OP_LABELS, TRIGGER_LABELS, type ActionType, type ConditionField, type TriggerType } from "@/lib/automation-meta";
import { CATEGORY_LABELS } from "@/lib/fileTypes";
import { formatBytes, formatDateTime, timeAgo } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { AutomationDto, AutomationRunDto } from "@/server/services/automations";

const MB = 1024 * 1024;

interface CondRow {
  field: ConditionField;
  op: string;
  value: string;
}
interface ActionRow {
  type: ActionType;
  folderId: string | null;
  tags: string;
  pattern: string;
  days: string;
}

const newAction = (): ActionRow => ({ type: "tag", folderId: null, tags: "", pattern: "{name}-{date}", days: "" });

function describeCondition(c: AutomationDto["conditions"][number]): string {
  const f = CONDITION_FIELDS[c.field as ConditionField]?.label ?? c.field;
  const v = c.field === "size" ? formatBytes(Number(c.value)) : c.field === "category" ? (CATEGORY_LABELS[c.value as keyof typeof CATEGORY_LABELS] ?? String(c.value)) : `“${c.value}”`;
  return `${f} ${OP_LABELS[c.op] ?? c.op} ${v}`;
}

function describeAction(a: AutomationDto["actions"][number]): string {
  switch (a.type) {
    case "move":
    case "copy":
      return `${ACTION_LABELS[a.type]}${a.folderId ? "" : " (top level)"}`;
    case "tag":
      return `Add tags: ${a.tags.join(", ")}`;
    case "rename":
      return `Rename to ${a.pattern}`;
    case "share":
      return a.expiresInDays ? `Create a share link (${a.expiresInDays} days)` : "Create a share link";
    default:
      return ACTION_LABELS[a.type];
  }
}

function AutomationDialog({ existing, onClose, onSaved }: { existing: AutomationDto | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [trigger, setTrigger] = useState<TriggerType>((existing?.trigger.type as TriggerType) ?? "file.uploaded");
  const [triggerFolder, setTriggerFolder] = useState<string | null>(existing?.trigger.folderId ?? null);
  const [conds, setConds] = useState<CondRow[]>(
    existing?.conditions.map((c) => ({ field: c.field as ConditionField, op: c.op, value: c.field === "size" ? String(Number(c.value) / MB) : String(c.value) })) ?? [],
  );
  const [actions, setActions] = useState<ActionRow[]>(
    existing?.actions.map((a) => ({
      ...newAction(),
      type: a.type,
      folderId: "folderId" in a ? a.folderId : null,
      tags: a.type === "tag" ? a.tags.join(", ") : "",
      pattern: a.type === "rename" ? a.pattern : "{name}-{date}",
      days: a.type === "share" && a.expiresInDays ? String(a.expiresInDays) : "",
    })) ?? [newAction()],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchCond = (i: number, p: Partial<CondRow>) => setConds((c) => c.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const patchAction = (i: number, p: Partial<ActionRow>) => setActions((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        trigger: { type: trigger, folderId: triggerFolder },
        conditions: conds.map((c) => ({ field: c.field, op: c.op, value: c.field === "size" ? Math.round(Number(c.value) * MB) : c.value.trim() })),
        actions: actions.map((a) => {
          switch (a.type) {
            case "move":
            case "copy":
              return { type: a.type, folderId: a.folderId };
            case "tag":
              return { type: "tag", tags: a.tags.split(",").map((t) => t.trim()).filter(Boolean) };
            case "rename":
              return { type: "rename", pattern: a.pattern };
            case "share":
              return { type: "share", expiresInDays: a.days ? Number(a.days) : null };
            default:
              return { type: a.type };
          }
        }),
      };
      await api(existing ? `/api/v1/automations/${existing.id}` : "/api/v1/automations", { method: existing ? "PATCH" : "POST", body });
      toast.success(existing ? "Automation updated" : "Automation created");
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={existing ? "Edit automation" : "New automation"} description="When something happens to a file, and it matches your conditions, do these things in order." size="lg">
      <form onSubmit={submit} className="space-y-5">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Field label="Name">{(p) => <Input {...p} value={name} maxLength={80} required autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. File invoices" />}</Field>

        <fieldset className="space-y-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-[13px] font-semibold">When</legend>
          <Field label="Trigger">
            {(p) => (
              <Select {...p} value={trigger} onChange={(e) => setTrigger(e.target.value as TriggerType)}>
                {Object.entries(TRIGGER_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Only in this folder" optional hint="Includes its subfolders.">
            {(p) => <FolderSelect id={p.id} value={triggerFolder} onChange={setTriggerFolder} rootLabel="Anywhere" />}
          </Field>
        </fieldset>

        <fieldset className="space-y-2 rounded-lg border border-line p-3">
          <legend className="px-1 text-[13px] font-semibold">If (all must match)</legend>
          {conds.length === 0 && <p className="text-xs text-subtle">No conditions: every matching event runs the actions.</p>}
          {conds.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select aria-label="Field" value={c.field} className="w-36" onChange={(e) => patchCond(i, { field: e.target.value as ConditionField, op: CONDITION_FIELDS[e.target.value as ConditionField].ops[0], value: "" })}>
                {Object.entries(CONDITION_FIELDS).map(([k, d]) => (
                  <option key={k} value={k}>
                    {d.label}
                  </option>
                ))}
              </Select>
              <Select aria-label="Comparison" value={c.op} className="w-40" onChange={(e) => patchCond(i, { op: e.target.value })}>
                {CONDITION_FIELDS[c.field].ops.map((o) => (
                  <option key={o} value={o}>
                    {OP_LABELS[o]}
                  </option>
                ))}
              </Select>
              {c.field === "category" ? (
                <Select aria-label="Type" value={c.value} className="w-36" onChange={(e) => patchCond(i, { value: e.target.value })} required>
                  <option value="">Choose…</option>
                  {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  aria-label="Value"
                  className="min-w-32 flex-1"
                  required
                  value={c.value}
                  type={c.field === "size" ? "number" : "text"}
                  min={c.field === "size" ? 0 : undefined}
                  step={c.field === "size" ? "any" : undefined}
                  placeholder={c.field === "size" ? "Size in MB" : c.field === "extension" ? "pdf" : ""}
                  onChange={(e) => patchCond(i, { value: e.target.value })}
                />
              )}
              <Button size="icon-sm" variant="ghost" aria-label="Remove condition" onClick={() => setConds((x) => x.filter((_, j) => j !== i))}>
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          {conds.length < 10 && (
            <Button size="sm" onClick={() => setConds((c) => [...c, { field: "extension", op: "is", value: "" }])} icon={<Plus className="size-4" aria-hidden />}>
              Add condition
            </Button>
          )}
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-[13px] font-semibold">Then</legend>
          {actions.map((a, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <span className="mt-2 w-5 text-xs text-subtle tnum">{i + 1}.</span>
              <Select aria-label="Action" value={a.type} className="w-48" onChange={(e) => patchAction(i, { type: e.target.value as ActionType })}>
                {Object.entries(ACTION_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
              {(a.type === "move" || a.type === "copy") && <FolderSelect value={a.folderId} onChange={(id) => patchAction(i, { folderId: id })} className="min-w-48 flex-1" />}
              {a.type === "tag" && <Input aria-label="Tags" required className="min-w-48 flex-1" placeholder="invoice, 2026" value={a.tags} onChange={(e) => patchAction(i, { tags: e.target.value })} />}
              {a.type === "rename" && (
                <Input aria-label="Name pattern" required className="min-w-48 flex-1 font-mono" value={a.pattern} onChange={(e) => patchAction(i, { pattern: e.target.value })} title="{name} {ext} {number} {date} {created}" />
              )}
              {a.type === "share" && <Input aria-label="Days until the link expires" type="number" min={1} max={3650} className="w-44" placeholder="Days (blank: plan default)" value={a.days} onChange={(e) => patchAction(i, { days: e.target.value })} />}
              <Button size="icon-sm" variant="ghost" aria-label="Remove action" disabled={actions.length === 1} onClick={() => setActions((x) => x.filter((_, j) => j !== i))}>
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          {actions.length < 8 && (
            <Button size="sm" onClick={() => setActions((a) => [...a, newAction()])} icon={<Plus className="size-4" aria-hidden />}>
              Add action
            </Button>
          )}
          {actions.some((a) => a.type === "rename") && <p className="text-xs text-subtle">Rename tokens: {"{name}"} {"{ext}"} {"{number}"} {"{date}"} {"{created}"}</p>}
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            {existing ? "Save changes" : "Create automation"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Runs({ id }: { id: string }) {
  const res = useResource<{ items: AutomationRunDto[] }>(`runs:${id}`, (signal) => api<{ items: AutomationRunDto[] }>(`/api/v1/automations/${id}/runs`, { signal }));
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Skeleton className="h-10" />;
  if (!res.data.items.length) return <p className="text-xs text-subtle">It hasn&apos;t run yet.</p>;
  return (
    <ul className="divide-y divide-line rounded-md border border-line text-[13px]">
      {res.data.items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <Badge tone={r.status === "success" ? "success" : r.status === "failed" ? "danger" : "neutral"}>{r.status}</Badge>
          <span className="min-w-0 flex-1 truncate text-muted">{r.error ?? r.detail ?? "—"}</span>
          <time className="text-xs text-subtle tnum" dateTime={r.createdAt} title={formatDateTime(r.createdAt)}>
            {timeAgo(r.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

export function AutomationsManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const can = useCan("manage");
  const enabled = useHasFeature("automations");
  const res = useResource<{ items: AutomationDto[] }>("automations", (signal) => api<{ items: AutomationDto[] }>("/api/v1/automations", { signal }));
  const [dialog, setDialog] = useState<{ existing: AutomationDto | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const items = res.data?.items ?? null;

  const toggle = async (a: AutomationDto) => {
    try {
      await api(`/api/v1/automations/${a.id}`, { method: "PATCH", body: { enabled: !a.enabled } });
      res.reload();
    } catch (err) {
      toast.error("Couldn't change the automation", errorMessage(err));
    }
  };
  const remove = async (a: AutomationDto) => {
    if (!(await confirm({ title: `Delete “${a.name}”?`, description: "Its run history is deleted too. Files it already changed stay as they are.", confirmLabel: "Delete", tone: "danger" }))) return;
    try {
      await api(`/api/v1/automations/${a.id}`, { method: "DELETE" });
      toast.success("Automation deleted");
      res.reload();
    } catch (err) {
      toast.error("Couldn't delete the automation", errorMessage(err));
    }
  };

  if (!enabled) return <FeatureGate feature="automations">{null}</FeatureGate>;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[13px] text-muted">Rules run in the background with your permissions. Actions an automation takes never trigger other automations, and every run is recorded below.</p>
        {can && (
          <Button variant="primary" onClick={() => setDialog({ existing: null })} icon={<Plus className="size-4" aria-hidden />}>
            New automation
          </Button>
        )}
      </div>
      {res.error && <ErrorNotice className="mb-3">{res.error}</ErrorNotice>}
      {!items && !res.error ? (
        <Skeleton className="h-28" />
      ) : items && items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<Workflow />} title="No automations yet" description="Sort invoices into a folder, tag every video, or archive old uploads: rules do the routine work for you." />
        </div>
      ) : (
        <ul className="space-y-3">
          {items?.map((a) => (
            <li key={a.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {a.name}
                    <Badge tone={a.enabled ? "success" : "neutral"}>{a.enabled ? "On" : "Off"}</Badge>
                  </h3>
                  <p className="mt-1 text-[13px] text-muted">
                    <span className="font-medium text-fg">When</span> {TRIGGER_LABELS[a.trigger.type as TriggerType]?.toLowerCase()}
                    {a.conditions.length > 0 && (
                      <>
                        , <span className="font-medium text-fg">if</span> {a.conditions.map(describeCondition).join(" and ")}
                      </>
                    )}
                    , <span className="font-medium text-fg">then</span> {a.actions.map(describeAction).join(", ")}.
                  </p>
                  <p className="mt-1.5 text-xs text-subtle tnum">
                    {a.runCount} {a.runCount === 1 ? "run" : "runs"}
                    {a.lastRunAt && ` · last ${timeAgo(a.lastRunAt)}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {can && (
                    <>
                      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                        <input type="checkbox" role="switch" checked={a.enabled} onChange={() => toggle(a)} className="size-4 accent-[var(--color-accent)]" />
                        Enabled
                      </label>
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${a.name}`} onClick={() => setDialog({ existing: a })}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${a.name}`} onClick={() => remove(a)}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)} icon={<History className="size-4" aria-hidden />}>
                    Runs <ChevronDown className={`size-3.5 transition-transform ${open === a.id ? "rotate-180" : ""}`} aria-hidden />
                  </Button>
                </div>
              </div>
              {open === a.id && (
                <div className="mt-3">
                  <Runs id={a.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog && <AutomationDialog existing={dialog.existing} onClose={() => setDialog(null)} onSaved={res.reload} />}
    </div>
  );
}
