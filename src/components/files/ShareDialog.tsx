"use client";

import { Eye, Link2, Lock, Sparkles, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAccount } from "@/components/layout/AccountContext";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { useConfirm } from "@/components/ui/Confirm";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/Field";
import { Badge, ErrorNotice, Spinner } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage, shareLink } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatDateTime, timeUntil } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { FeatureKey } from "@/config/entitlements";
import type { ShareDto } from "@/lib/types";
import { DEFAULT_EXPIRY, ExpiryField, expiryValueToApi, type ExpiryValue } from "./ExpiryField";

export interface ShareTarget {
  kind: "file" | "folder";
  id: string;
  name: string;
}

export interface ShareFormState {
  password: "keep" | "set" | "remove";
  passwordValue: string;
  expiry: ExpiryValue;
  maxDownloads: string;
  maxViews: string;
  allowDownload: boolean;
  ipAllowlist: string;
  title: string;
  message: string;
  embedEnabled: boolean;
  showSha256: boolean;
}

export const NEW_SHARE_FORM: ShareFormState = {
  password: "set",
  passwordValue: "",
  expiry: DEFAULT_EXPIRY,
  maxDownloads: "",
  maxViews: "",
  allowDownload: true,
  ipAllowlist: "",
  title: "",
  message: "",
  embedEnabled: false,
  showSha256: true,
};

const digits = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 8);
const positive = (v: string) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function PlanChip({ feature }: { feature: FeatureKey }) {
  const { plan } = useAccount();
  if (plan.features[feature]) return null;
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 text-[10px] font-medium text-accent" title="Not included in your current plan">
      <Sparkles className="size-3" aria-hidden /> Upgrade
    </span>
  );
}

/** Builds the API body. Fields the plan doesn't include are never sent, so a gated option can't fail the whole request. */
export function shareBody(form: ShareFormState, mode: "create" | "edit", features: Record<FeatureKey, boolean>): Record<string, unknown> {
  const body: Record<string, unknown> = { showSha256: form.showSha256 };
  if (form.password === "set" && form.passwordValue) body.password = form.passwordValue;
  if (form.password === "remove") body.password = null;
  const exp = expiryValueToApi(form.expiry);
  if (exp !== undefined) body.expiresAt = exp;
  if (features.shareLimits) {
    body.maxDownloads = positive(form.maxDownloads);
    body.maxViews = positive(form.maxViews);
  }
  if (features.sharePermissions) {
    body.permissions = form.allowDownload ? ["view", "download"] : ["view"];
    body.ipAllowlist = form.ipAllowlist.split(/[\s,]+/).filter(Boolean);
  }
  if (features.customBranding) {
    body.title = form.title.trim() || null;
    body.message = form.message.trim() || null;
  }
  if (features.embeds) body.embedEnabled = form.embedEnabled;
  if (mode === "create") {
    for (const k of Object.keys(body)) if (body[k] === null && k !== "expiresAt") delete body[k];
  }
  return body;
}

export function ShareOptionsFields({ form, setForm, existing, idPrefix }: { form: ShareFormState; setForm: (f: ShareFormState) => void; existing?: ShareDto; idPrefix: string }) {
  const { plan } = useAccount();
  const f = plan.features;
  const set = <K extends keyof ShareFormState>(k: K, v: ShareFormState[K]) => setForm({ ...form, [k]: v });
  return (
    <div className="space-y-3.5">
      {existing ? (
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium">Password</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {(existing.hasPassword ? (["keep", "set", "remove"] as const) : (["keep", "set"] as const)).map((opt) => (
              <label key={opt} className="inline-flex cursor-pointer items-center gap-1.5">
                <input type="radio" name={`${idPrefix}-pw`} checked={form.password === opt} onChange={() => set("password", opt)} className="accent-[var(--accent)]" />
                {opt === "keep" ? (existing.hasPassword ? "Keep current" : "No password") : opt === "set" ? (existing.hasPassword ? "Change" : "Set a password") : "Remove"}
              </label>
            ))}
          </div>
          {form.password === "set" && <Input aria-label="New password" type="password" autoComplete="new-password" minLength={4} maxLength={128} required value={form.passwordValue} onChange={(e) => set("passwordValue", e.target.value)} placeholder="At least 4 characters" />}
        </fieldset>
      ) : (
        <Field label="Password" optional hint="Visitors need it to view or download.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" minLength={4} maxLength={128} value={form.passwordValue} onChange={(e) => setForm({ ...form, passwordValue: e.target.value, password: "set" })} />}
        </Field>
      )}
      <ExpiryField value={form.expiry} onChange={(expiry) => set("expiry", expiry)} label="Link expiry" keepLabel={existing ? (existing.expiresAt ? `Keep (${formatDateTime(existing.expiresAt)})` : "Keep (never expires)") : "Doesn't expire"} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={<>Download limit<PlanChip feature="shareLimits" /></>} optional hint="The link stops after this many downloads.">
          {(p) => <Input {...p} inputMode="numeric" value={form.maxDownloads} disabled={!f.shareLimits} onChange={(e) => set("maxDownloads", digits(e.target.value))} placeholder="Unlimited" />}
        </Field>
        <Field label={<>View limit<PlanChip feature="shareLimits" /></>} optional hint="The link stops after this many page views.">
          {(p) => <Input {...p} inputMode="numeric" value={form.maxViews} disabled={!f.shareLimits} onChange={(e) => set("maxViews", digits(e.target.value))} placeholder="Unlimited" />}
        </Field>
      </div>

      <div className="space-y-2">
        <Checkbox checked={form.allowDownload} disabled={!f.sharePermissions} onChange={(e) => set("allowDownload", e.target.checked)} label={<>Allow downloading<PlanChip feature="sharePermissions" /></>} />
        {!form.allowDownload && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Eye className="size-3.5" aria-hidden /> Visitors can preview but not download. Previews are still served by the server, so this limits casual saving, not screenshots.
          </p>
        )}
        <Field label={<>Only from these networks<PlanChip feature="sharePermissions" /></>} optional hint="IP addresses or IPv4 ranges (like 203.0.113.0/24), separated by commas or new lines.">
          {(p) => <Textarea {...p} rows={2} value={form.ipAllowlist} disabled={!f.sharePermissions} onChange={(e) => set("ipAllowlist", e.target.value)} placeholder="Anyone" />}
        </Field>
      </div>

      <div className="space-y-2">
        <Field label={<>Heading on the link page<PlanChip feature="customBranding" /></>} optional>
          {(p) => <Input {...p} maxLength={120} value={form.title} disabled={!f.customBranding} onChange={(e) => set("title", e.target.value)} />}
        </Field>
        <Field label={<>Message to visitors<PlanChip feature="customBranding" /></>} optional>
          {(p) => <Textarea {...p} rows={2} maxLength={1000} value={form.message} disabled={!f.customBranding} onChange={(e) => set("message", e.target.value)} />}
        </Field>
      </div>

      <div className="space-y-1.5">
        <Checkbox checked={form.embedEnabled} disabled={!f.embeds} onChange={(e) => set("embedEnabled", e.target.checked)} label={<>Allow embedding on other sites<PlanChip feature="embeds" /></>} />
        {existing?.embedEnabled && form.embedEnabled && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="min-w-0 flex-1 truncate font-mono">{`${typeof window !== "undefined" ? window.location.origin : ""}/dl/${existing.token}?mode=preview&embed=1`}</span>
            <CopyButton value={() => `${window.location.origin}/dl/${existing.token}?mode=preview&embed=1`} iconOnly size="sm" label="Copy embed address" />
          </div>
        )}
        <Checkbox checked={form.showSha256} onChange={(e) => set("showSha256", e.target.checked)} label="Show the SHA-256 checksum on the link page" />
      </div>
    </div>
  );
}

function stateBadge(share: ShareDto) {
  if (share.state === "revoked") return <Badge tone="danger">Revoked</Badge>;
  if (share.state === "expired") return <Badge tone="warning">Expired</Badge>;
  if (share.state === "exhausted") return <Badge tone="warning">Limit reached</Badge>;
  return <Badge tone="success">Active</Badge>;
}

function formFromShare(s: ShareDto): ShareFormState {
  return {
    password: "keep",
    passwordValue: "",
    expiry: DEFAULT_EXPIRY,
    maxDownloads: s.maxDownloads ? String(s.maxDownloads) : "",
    maxViews: s.maxViews ? String(s.maxViews) : "",
    allowDownload: s.permissions.includes("download"),
    ipAllowlist: s.ipAllowlist.join("\n"),
    title: s.title ?? "",
    message: s.message ?? "",
    embedEnabled: s.embedEnabled,
    showSha256: s.showSha256,
  };
}

function ShareCard({ share, onChanged }: { share: ShareDto; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { plan } = useAccount();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ShareFormState>(() => formFromShare(share));
  const url = shareLink(share.token);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/shares/${share.id}`, { method: "PATCH", body: shareBody(form, "edit", plan.features) });
      toast.success("Link updated");
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!(await confirm({ title: "Revoke this link?", description: "Anyone who has the link will lose access immediately. This can't be undone, but you can create a new link.", confirmLabel: "Revoke link", tone: "danger" }))) return;
    try {
      await api(`/api/v1/shares/${share.id}`, { method: "PATCH", body: { revoked: true } });
      toast.success("Link revoked");
      onChanged();
    } catch (err) {
      toast.error("Couldn't revoke the link", errorMessage(err));
    }
  };
  const remove = async () => {
    try {
      await api(`/api/v1/shares/${share.id}`, { method: "DELETE" });
      toast.success("Link deleted");
      onChanged();
    } catch (err) {
      toast.error("Couldn't delete the link", errorMessage(err));
    }
  };

  const inactive = share.state !== "active";
  return (
    <div className={cn("rounded-lg border border-line p-3", inactive && "opacity-75")}>
      <div className="flex flex-wrap items-center gap-2">
        {stateBadge(share)}
        {share.hasPassword && (
          <Badge icon={<Lock className="size-3" aria-hidden />} tone="neutral">
            Password
          </Badge>
        )}
        {!share.permissions.includes("download") && <Badge icon={<Eye className="size-3" aria-hidden />}>View only</Badge>}
        {share.ipAllowlist.length > 0 && <Badge>{share.ipAllowlist.length} network rule{share.ipAllowlist.length === 1 ? "" : "s"}</Badge>}
        <span className="text-xs text-muted tnum">
          {share.expiresAt ? `${timeUntil(share.expiresAt)} (${formatDateTime(share.expiresAt)})` : "Doesn't expire"}
          {` · ${share.viewCount}${share.maxViews ? `/${share.maxViews}` : ""} views`}
          {` · ${share.downloadCount}${share.maxDownloads ? `/${share.maxDownloads}` : ""} downloads`}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input readOnly aria-label="Share link" value={url} onFocus={(e) => e.currentTarget.select()} className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-2.5 font-mono text-xs" />
        {!inactive && <CopyButton value={url} variant="primary" />}
      </div>
      {!editing ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!inactive && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit link settings
            </Button>
          )}
          {!inactive && (
            <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={revoke}>
              Revoke
            </Button>
          )}
          {inactive && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" aria-hidden />} onClick={remove}>
              Delete record
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={save} className="mt-3 space-y-3 border-t border-line pt-3">
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <ShareOptionsFields form={form} setForm={setForm} existing={share} idPrefix={share.id} />
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" variant="primary" loading={busy}>
              Save changes
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ShareDialog({ target, onClose, onChanged }: { target: ShareTarget; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { plan } = useAccount();
  const targetId = target.id;
  const sharesRes = useResource(`share-dialog-${target.kind}-${targetId}`, async (signal) => {
    const res = await api<{ items: ShareDto[] }>("/api/v1/shares", { signal });
    const mine = res.items.filter((s) => (target.kind === "file" ? s.fileId === targetId : s.folderId === targetId));
    const rank = (s: ShareDto) => (s.state === "active" ? 0 : 1);
    return mine.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
  });
  const shares = sharesRes.data;
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? sharesRes.error;
  const [creating, setCreating] = useState(false);
  const [formOverride, setFormOverride] = useState<boolean | null>(null);
  const showForm = formOverride ?? (shares ? shares.every((s) => s.state !== "active") : false);
  const [form, setForm] = useState<ShareFormState>(NEW_SHARE_FORM);
  const load = async () => sharesRes.reload();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api("/api/v1/shares", { method: "POST", body: { ...(target.kind === "file" ? { fileId: targetId } : { folderId: targetId }), ...shareBody(form, "create", plan.features) } });
      toast.success("Link created");
      setForm(NEW_SHARE_FORM);
      setFormOverride(false);
      await load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Share" description={<span className="break-all">{target.name}</span>} size="lg">
      {error && <ErrorNotice className="mb-3">{error}</ErrorNotice>}
      {!shares ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-3">
          {shares.map((s) => (
            <ShareCard
              key={s.id}
              share={s}
              onChanged={() => {
                void load();
                onChanged();
              }}
            />
          ))}
          {showForm ? (
            <form onSubmit={create} className="space-y-3 rounded-lg border border-dashed border-line-strong p-3">
              <p className="flex items-center gap-2 text-[13px] font-medium">
                <Link2 className="size-4 text-accent" aria-hidden /> {shares.length ? "Create another link" : "Create a public link"}
              </p>
              <ShareOptionsFields form={form} setForm={setForm} idPrefix="new" />
              <div className="flex justify-end gap-2">
                {shares.some((s) => s.state === "active") && <Button onClick={() => setFormOverride(false)}>Cancel</Button>}
                <Button type="submit" variant="primary" loading={creating}>
                  Create link
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setFormOverride(true)} icon={<Link2 className="size-4" aria-hidden />}>
              New link
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
