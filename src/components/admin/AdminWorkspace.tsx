"use client";

import { Inbox, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FEATURES, FEATURE_KEYS, LIMITS, LIMIT_KEYS, type FeatureKey, type LimitKey } from "@/config/entitlements";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Checkbox, Field, Input, Select } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatBytes, formatDate, formatMoney, timeAgo } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { ShareDto } from "@/lib/types";
import { useCursorList } from "./useCursorList";

function SearchBox({ value, onSubmit, placeholder }: { value: string; onSubmit: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  return (
    <form
      role="search"
      aria-label={placeholder}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft.trim());
      }}
      className="relative"
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" aria-hidden />
      <Input aria-label={placeholder} placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 w-64 pl-8 text-[13px]" />
    </form>
  );
}

function Rows({ loading, error, empty, children }: { loading: boolean; error: string | null; empty: boolean; children: React.ReactNode }) {
  if (error) return <ErrorNotice>{error}</ErrorNotice>;
  if (loading)
    return (
      <div className="space-y-2">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  if (empty) return <div className="rounded-lg border border-line bg-surface"><EmptyState icon={<Inbox />} title="Nothing here" description="No records match." /></div>;
  return <>{children}</>;
}

/* ------------------------------------------------------------------------------------------- */

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  planKey: string;
  ownerEmail: string;
  members: number;
  files: number;
  usedBytes: number;
  createdAt: string;
}
interface OrgDetail {
  id: string;
  name: string;
  planKey: string;
  usedBytes: number;
  members: Array<{ userId: string; name: string; email: string; role: string }>;
}

function AssignPlanDialog({ subject, currentPlan, onClose, onDone }: { subject: { type: "user" | "org"; id: string; label: string }; currentPlan: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const plans = useResource<{ items: Array<{ key: string; name: string }> }>("admin-plan-options", (signal) => api("/api/v1/admin/plans", { signal }));
  const [planKey, setPlanKey] = useState(currentPlan);
  const [interval, setInterval] = useState("month");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/admin/subscriptions", { method: "POST", body: { subjectType: subject.type, subjectId: subject.id, planKey, interval } });
      toast.success("Plan assigned");
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Assign a plan" description={`${subject.label}. The change is immediate and is refused if their usage exceeds the new plan.`} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Field label="Plan">
          {(p) => (
            <Select {...p} value={planKey} onChange={(e) => setPlanKey(e.target.value)} disabled={!plans.data}>
              {plans.data?.items.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Billing period">
          {(p) => (
            <Select {...p} value={interval} onChange={(e) => setInterval(e.target.value)}>
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </Select>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!plans.data || planKey === currentPlan}>
            Assign
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminOrgs() {
  const [q, setQ] = useState("");
  const list = useCursorList<OrgRow>("/api/v1/admin/orgs", { q: q || undefined });
  const [open, setOpen] = useState<string | null>(null);
  const [assign, setAssign] = useState<OrgRow | null>(null);
  const detail = useResource<OrgDetail | null>(`admin-org:${open}`, (signal) => (open ? api<OrgDetail>(`/api/v1/admin/orgs/${open}`, { signal }) : Promise.resolve(null)));
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <SearchBox value={q} onSubmit={setQ} placeholder="Search name, slug or id" />
      </div>
      <Rows loading={!list.items} error={list.error} empty={list.items?.length === 0}>
        <div role="region" aria-label="Organizations" tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-subtle">
                <th className="px-4 py-2 font-medium">Organization</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 text-right font-medium">Members</th>
                <th className="px-3 py-2 text-right font-medium">Files</th>
                <th className="px-3 py-2 text-right font-medium">Storage</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.items?.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2">
                    <button type="button" className="font-medium text-accent hover:underline" onClick={() => setOpen(o.id)}>
                      {o.name}
                    </button>
                    <p className="text-xs text-subtle">{o.slug} · created {formatDate(o.createdAt)}</p>
                  </td>
                  <td className="px-3 py-2 text-muted">{o.ownerEmail}</td>
                  <td className="px-3 py-2">
                    <Badge>{o.planKey}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right tnum">{o.members}</td>
                  <td className="px-3 py-2 text-right tnum">{o.files.toLocaleString("en-US")}</td>
                  <td className="px-3 py-2 text-right tnum">{formatBytes(o.usedBytes)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" onClick={() => setAssign(o)}>
                      Change plan
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Rows>
      {list.hasMore && (
        <div className="mt-3 flex justify-center">
          <Button onClick={list.loadMore} loading={list.loadingMore}>
            Load more
          </Button>
        </div>
      )}
      <Modal open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={detail.data?.name ?? "Organization"} description={detail.data ? `${formatBytes(detail.data.usedBytes)} stored · plan ${detail.data.planKey}` : undefined} size="md">
        {detail.error ? (
          <ErrorNotice>{detail.error}</ErrorNotice>
        ) : !detail.data ? (
          <Skeleton className="h-32" />
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line text-[13px]">
            {detail.data.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 px-3 py-2">
                <Link href={`/admin/users/${m.userId}`} className="min-w-0 flex-1 truncate hover:text-accent hover:underline">
                  {m.name} <span className="text-xs text-subtle">{m.email}</span>
                </Link>
                <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{m.role}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      {assign && <AssignPlanDialog subject={{ type: "org", id: assign.id, label: assign.name }} currentPlan={assign.planKey} onClose={() => setAssign(null)} onDone={list.reload} />}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

type AdminShare = ShareDto & { ownerEmail: string };

export function AdminShares() {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const list = useCursorList<AdminShare>("/api/v1/admin/shares", { status, q: q || undefined });

  const revoke = async (s: AdminShare) => {
    if (!(await confirm({ title: "Revoke this link?", description: `Anyone with the link to “${s.targetName}” loses access immediately. The owner is not notified automatically.`, confirmLabel: "Revoke", tone: "danger" }))) return;
    try {
      await api(`/api/v1/admin/shares/${s.id}`, { method: "DELETE" });
      toast.success("Link revoked");
      list.reload();
    } catch (err) {
      toast.error("Couldn't revoke the link", errorMessage(err));
    }
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Link status" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {["active", "revoked", "all"].map((s) => (
            <button key={s} role="tab" type="button" aria-selected={status === s} onClick={() => setStatus(s)} className={`rounded-md px-3 py-1.5 text-[13px] font-medium capitalize ${status === s ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
              {s}
            </button>
          ))}
        </div>
        <SearchBox value={q} onSubmit={setQ} placeholder="Token, owner email or file name" />
      </div>
      <Rows loading={!list.items} error={list.error} empty={list.items?.length === 0}>
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {list.items?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate font-medium">{s.targetName}</p>
                <p className="truncate text-xs text-muted">
                  {s.ownerEmail} · <span className="font-mono">/d/{s.token}</span>
                </p>
              </div>
              <Badge tone={s.state === "active" ? "success" : s.state === "revoked" ? "danger" : "warning"}>{s.state}</Badge>
              <span className="text-xs text-muted tnum">
                {s.viewCount} views · {s.downloadCount} downloads
              </span>
              <span className="text-xs text-subtle">created {timeAgo(s.createdAt)}</span>
              {!s.revokedAt && (
                <Button size="sm" variant="danger-outline" onClick={() => revoke(s)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Rows>
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

/* ------------------------------------------------------------------------------------------- */

interface SubRow {
  id: string;
  subject: { type: string; label: string; id: string | null };
  planKey: string;
  status: string;
  interval: string;
  provider: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export function AdminSubscriptions() {
  const [status, setStatus] = useState("all");
  const list = useCursorList<SubRow>("/api/v1/admin/subscriptions", { status });
  return (
    <div>
      <ErrorNotice tone="info" className="mb-4">To change someone&apos;s plan, use “Change plan” on their user page or on Organizations. Every change is recorded in the audit log.</ErrorNotice>
      <div role="tablist" aria-label="Subscription status" className="mb-3 inline-flex rounded-lg border border-line bg-surface p-0.5">
        {["all", "active", "trialing", "past_due", "canceled"].map((s) => (
          <button key={s} role="tab" type="button" aria-selected={status === s} onClick={() => setStatus(s)} className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${status === s ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
            {s.replace("_", " ")}
          </button>
        ))}
      </div>
      <Rows loading={!list.items} error={list.error} empty={list.items?.length === 0}>
        <div role="region" aria-label="Subscriptions" tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-subtle">
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Managed by</th>
                <th className="px-3 py-2 font-medium">Period ends</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.items?.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2">
                    {s.subject.label} <span className="text-xs text-subtle">({s.subject.type})</span>
                  </td>
                  <td className="px-3 py-2">
                    {s.planKey} <span className="text-xs text-subtle">/ {s.interval}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={s.status === "active" ? "success" : s.status === "past_due" ? "danger" : "neutral"}>{s.status.replace("_", " ")}</Badge>
                    {s.cancelAtPeriodEnd && <span className="ml-2 text-xs text-warning">cancels</span>}
                  </td>
                  <td className="px-3 py-2 text-muted">{s.provider === "stripe" ? "Stripe" : "Administrator"}</td>
                  <td className="px-3 py-2 text-muted">{s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Rows>
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

/* ------------------------------------------------------------------------------------------- */

interface Plan {
  key: string;
  name: string;
  description: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  features: Record<FeatureKey, boolean>;
  limits: Record<LimitKey, number>;
  isPublic: boolean;
  isDefault: boolean;
  sortOrder: number;
  providerPrices: { stripe?: { month?: string; year?: string } };
  users: number;
  organizations: number;
}

const GB = 1024 ** 3;

function LimitInput({ k, value, onChange }: { k: LimitKey; value: number; onChange: (v: number) => void }) {
  const def = LIMITS[k];
  const unlimited = value < 0;
  const bytes = def.unit === "bytes";
  const shown = unlimited ? "" : String(bytes ? Number((value / GB).toFixed(3)) : value);
  return (
    <div className="flex items-center gap-2 py-1 text-[13px]">
      <label htmlFor={`lim-${k}`} className="min-w-0 flex-1">
        <span className="font-medium">{def.label}</span>
        <span className="ml-1.5 text-xs text-subtle">{def.description}</span>
      </label>
      <Input
        id={`lim-${k}`}
        type="number"
        min={0}
        step={bytes ? "any" : 1}
        className="h-8 w-28"
        disabled={unlimited}
        value={shown}
        placeholder="∞"
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(bytes ? Math.round(n * GB) : Math.round(n));
        }}
      />
      <span className="w-12 text-xs text-subtle">{bytes ? "GB" : def.unit === "days" ? "days" : def.unit === "perMinute" ? "/ min" : def.unit === "perMonth" ? "/ mo" : ""}</span>
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={unlimited} onChange={(e) => onChange(e.target.checked ? -1 : 0)} className="size-3.5 accent-[var(--color-accent)]" /> ∞
      </label>
    </div>
  );
}

function PlanDialog({ existing, onClose, onSaved }: { existing: Plan | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState(existing?.key ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [monthly, setMonthly] = useState(existing ? String(existing.priceMonthlyCents / 100) : "0");
  const [yearly, setYearly] = useState(existing ? String(existing.priceYearlyCents / 100) : "0");
  const [currency, setCurrency] = useState(existing?.currency ?? "usd");
  const [features, setFeatures] = useState<Record<string, boolean>>(existing?.features ?? {});
  const [limits, setLimits] = useState<Record<string, number>>(existing?.limits ?? {});
  const [isPublic, setPublic] = useState(existing?.isPublic ?? false);
  const [isDefault, setDefault] = useState(existing?.isDefault ?? false);
  const [sortOrder, setSortOrder] = useState(String(existing?.sortOrder ?? 100));
  const [stripeMonth, setStripeMonth] = useState(existing?.providerPrices.stripe?.month ?? "");
  const [stripeYear, setStripeYear] = useState(existing?.providerPrices.stripe?.year ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        priceMonthlyCents: Math.round(Number(monthly) * 100),
        priceYearlyCents: Math.round(Number(yearly) * 100),
        currency,
        features,
        limits,
        isPublic,
        ...(existing ? (isDefault && !existing.isDefault ? { isDefault: true } : {}) : {}),
        sortOrder: Number(sortOrder),
        stripe: { month: stripeMonth.trim(), year: stripeYear.trim() },
      };
      await api(existing ? `/api/v1/admin/plans/${existing.key}` : "/api/v1/admin/plans", { method: existing ? "PATCH" : "POST", body: existing ? body : { ...body, key } });
      toast.success(existing ? "Plan saved" : "Plan created");
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const groups = [...new Set(FEATURE_KEYS.map((k) => FEATURES[k].group))];
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={existing ? `Edit ${existing.name}` : "New plan"} description={existing ? `${existing.users} users and ${existing.organizations} organizations are on this plan. Changes apply to all of them immediately.` : undefined} size="xl">
      <form onSubmit={submit} className="space-y-5">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="grid gap-4 sm:grid-cols-3">
          {!existing && <Field label="Key" hint="Lowercase, permanent.">{(p) => <Input {...p} value={key} required pattern="[a-z][a-z0-9_-]{1,29}" onChange={(e) => setKey(e.target.value)} />}</Field>}
          <Field label="Name">{(p) => <Input {...p} value={name} required maxLength={40} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Sort order">{(p) => <Input {...p} type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />}</Field>
        </div>
        <Field label="Description">{(p) => <Input {...p} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Monthly price">{(p) => <Input {...p} type="number" min={0} step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} />}</Field>
          <Field label="Yearly price (total)">{(p) => <Input {...p} type="number" min={0} step="0.01" value={yearly} onChange={(e) => setYearly(e.target.value)} />}</Field>
          <Field label="Currency">{(p) => <Input {...p} value={currency} maxLength={3} minLength={3} onChange={(e) => setCurrency(e.target.value.toLowerCase())} />}</Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Checkbox label="Shown on the pricing page" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} />
          <Checkbox label="Default plan for new accounts" checked={isDefault} disabled={existing?.isDefault} onChange={(e) => setDefault(e.target.checked)} />
        </div>

        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold">Features</legend>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g}>
                <p className="mb-1 text-xs font-medium text-subtle">{g}</p>
                {FEATURE_KEYS.filter((k) => FEATURES[k].group === g).map((k) => (
                  <Checkbox key={k} label={FEATURES[k].label} checked={!!features[k]} onChange={(e) => setFeatures((f) => ({ ...f, [k]: e.target.checked }))} />
                ))}
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-[13px] font-semibold">Limits</legend>
          <div className="divide-y divide-line">
            {LIMIT_KEYS.map((k) => (
              <LimitInput key={k} k={k} value={limits[k] ?? 0} onChange={(v) => setLimits((l) => ({ ...l, [k]: v }))} />
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-1 text-[13px] font-semibold">Stripe price IDs</legend>
          <Field label="Monthly" optional hint="Only needed if card payments are enabled.">{(p) => <Input {...p} value={stripeMonth} placeholder="price_…" onChange={(e) => setStripeMonth(e.target.value)} />}</Field>
          <Field label="Yearly" optional>{(p) => <Input {...p} value={stripeYear} placeholder="price_…" onChange={(e) => setStripeYear(e.target.value)} />}</Field>
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || (!existing && !key)}>
            {existing ? "Save plan" : "Create plan"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminPlans() {
  const res = useResource<{ items: Plan[] }>("admin-plans", (signal) => api<{ items: Plan[] }>("/api/v1/admin/plans", { signal }));
  const [dialog, setDialog] = useState<{ existing: Plan | null } | null>(null);
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Skeleton className="h-64" />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[13px] text-muted">Plans are data: the pricing page, upgrade prompts and every server-side limit read from these records. Edit a limit and it changes for everyone on the plan straight away.</p>
        <Button variant="primary" onClick={() => setDialog({ existing: null })} icon={<Plus className="size-4" aria-hidden />}>
          New plan
        </Button>
      </div>
      <div role="region" aria-label="Plans" tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-xs text-subtle">
              <th className="px-4 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Price</th>
              <th className="px-3 py-2 font-medium">Storage</th>
              <th className="px-3 py-2 font-medium">Largest file</th>
              <th className="px-3 py-2 font-medium">Visibility</th>
              <th className="px-3 py-2 text-right font-medium">Accounts</th>
              <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {res.data.items.map((p) => (
              <tr key={p.key}>
                <td className="px-4 py-2">
                  <p className="font-medium">
                    {p.name} {p.isDefault && <Badge tone="accent">Default</Badge>}
                  </p>
                  <p className="font-mono text-xs text-subtle">{p.key}</p>
                </td>
                <td className="px-3 py-2 tnum">{p.priceMonthlyCents > 0 ? `${formatMoney(p.priceMonthlyCents, p.currency)} / mo` : "Free"}</td>
                <td className="px-3 py-2 tnum">{p.limits.storageBytes < 0 ? "Unlimited" : formatBytes(p.limits.storageBytes, 0)}</td>
                <td className="px-3 py-2 tnum">{p.limits.maxFileBytes < 0 ? "Unlimited" : formatBytes(p.limits.maxFileBytes, 0)}</td>
                <td className="px-3 py-2">
                  <Badge tone={p.isPublic ? "success" : "neutral"}>{p.isPublic ? "Public" : "Hidden"}</Badge>
                </td>
                <td className="px-3 py-2 text-right tnum">{p.users + p.organizations}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" onClick={() => setDialog({ existing: p })}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog && <PlanDialog existing={dialog.existing} onClose={() => setDialog(null)} onSaved={res.reload} />}
    </div>
  );
}

export { AssignPlanDialog };
