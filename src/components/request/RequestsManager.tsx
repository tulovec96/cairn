"use client";

import { Inbox, Lock, Pencil, Plus, Power, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FeatureGate } from "@/components/common/Upgrade";
import { useAccount, useCan, useHasFeature } from "@/components/layout/AccountContext";
import { DEFAULT_EXPIRY, ExpiryField, expiryValueToApi, type ExpiryValue } from "@/components/files/ExpiryField";
import { FolderSelect } from "@/components/files/FolderSelect";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { CopyButton } from "@/components/ui/CopyButton";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api, errorMessage } from "@/lib/api-client";
import { formatBytes, formatDateTime, pluralize, timeUntil } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { FileRequestDto } from "@/server/services/fileRequests";

const STATE_TONE = { open: "success", closed: "neutral", expired: "warning", full: "warning" } as const;
const MB = 1024 * 1024;
const GB = 1024 * MB;

function RequestDialog({ existing, onClose, onSaved }: { existing: FileRequestDto | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const branding = useHasFeature("customBranding");
  const portals = useHasFeature("portals");
  const { plan } = useAccount();
  const [kind, setKind] = useState<"request" | "portal">(existing?.kind ?? "request");
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [folderId, setFolderId] = useState<string | null>(existing?.folderId ?? null);
  const [expiry, setExpiry] = useState<ExpiryValue>(existing ? DEFAULT_EXPIRY : { choice: "never", custom: "" });
  const [maxFileMb, setMaxFileMb] = useState(existing?.maxFileBytes ? String(Math.round(existing.maxFileBytes / MB)) : "");
  const [maxFiles, setMaxFiles] = useState(existing?.maxFiles ? String(existing.maxFiles) : "");
  const [maxTotalGb, setMaxTotalGb] = useState(existing?.maxTotalBytes ? String(Number((existing.maxTotalBytes / GB).toFixed(2))) : "");
  const [extensions, setExtensions] = useState(existing?.allowedExtensions.join(", ") ?? "");
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [notify, setNotify] = useState(existing?.notifyOnUpload ?? true);
  const [brandName, setBrandName] = useState(existing?.brandName ?? "");
  const [accent, setAccent] = useState(existing?.accent ?? "");
  const [welcome, setWelcome] = useState(existing?.welcomeMessage ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const num = (v: string, mult = 1) => (v.trim() ? Math.round(Number(v) * mult) : null);
      const exp = expiryValueToApi(expiry);
      const body: Record<string, unknown> = {
        kind,
        name: name.trim(),
        description: description.trim(),
        folderId,
        maxFileBytes: num(maxFileMb, MB),
        maxFiles: num(maxFiles),
        maxTotalBytes: num(maxTotalGb, GB),
        allowedExtensions: extensions
          .split(/[\s,]+/)
          .map((x) => x.replace(/^\./, "").toLowerCase())
          .filter(Boolean),
        notifyOnUpload: notify,
        ...(exp !== undefined ? { expiresAt: exp } : {}),
        ...(password ? { password } : removePassword ? { password: null } : {}),
        ...(branding ? { brandName: brandName.trim() || null, accent: accent.trim() || null, welcomeMessage: welcome.trim() || null } : {}),
      };
      await api(existing ? `/api/v1/requests/${existing.id}` : "/api/v1/requests", { method: existing ? "PATCH" : "POST", body });
      toast.success(existing ? "Request updated" : "Request created");
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFields(err.fieldErrors());
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={existing ? "Edit request" : "New file request"} description="People upload through the link without an account. They can add files here and can never see what's inside." size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {!existing && (
          <div role="radiogroup" aria-label="Type" className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { v: "request", t: "One-off request", d: "Ask specific people for files. Set a limit and an expiry." },
                { v: "portal", t: "Upload portal", d: "A reusable, branded page for ongoing uploads.", locked: !portals },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={kind === o.v}
                disabled={"locked" in o && o.locked}
                onClick={() => setKind(o.v)}
                className={`rounded-lg border p-3 text-left text-[13px] disabled:opacity-50 ${kind === o.v ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`}
              >
                <span className="block font-medium">{o.t}</span>
                <span className="text-xs text-muted">{"locked" in o && o.locked ? `Not included in ${plan.name}.` : o.d}</span>
              </button>
            ))}
          </div>
        )}
        <Field label="Name" error={fields.name}>
          {(p) => <Input {...p} value={name} maxLength={100} required autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Signed contracts" />}
        </Field>
        <Field label="What are you asking for?" optional>
          {(p) => <Textarea {...p} rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <Field label="Files land in" hint="Uploaded files are stored in this folder.">
          {(p) => <FolderSelect id={p.id} aria-describedby={p["aria-describedby"]} value={folderId} onChange={setFolderId} />}
        </Field>
        <ExpiryField value={expiry} onChange={setExpiry} label="Link expires" allowKeep={!!existing} keepLabel="Keep the current expiry" error={fields.expiresAt} />
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-1 text-[13px] font-medium">Limits</legend>
          <Field label="Max file size (MB)" optional error={fields.maxFileBytes}>
            {(p) => <Input {...p} type="number" min={1} inputMode="numeric" value={maxFileMb} onChange={(e) => setMaxFileMb(e.target.value)} />}
          </Field>
          <Field label="Max number of files" optional error={fields.maxFiles}>
            {(p) => <Input {...p} type="number" min={1} inputMode="numeric" value={maxFiles} onChange={(e) => setMaxFiles(e.target.value)} />}
          </Field>
          <Field label="Max total size (GB)" optional error={fields.maxTotalBytes}>
            {(p) => <Input {...p} type="number" min={0.001} step="any" inputMode="decimal" value={maxTotalGb} onChange={(e) => setMaxTotalGb(e.target.value)} />}
          </Field>
        </fieldset>
        <Field label="Only accept these extensions" optional hint="Separate with commas, e.g. pdf, docx, png. Blank allows any type your server permits.">
          {(p) => <Input {...p} value={extensions} onChange={(e) => setExtensions(e.target.value)} />}
        </Field>
        <Field label={existing?.hasPassword ? "New password" : "Password"} optional hint={existing?.hasPassword ? "Leave blank to keep the current password." : "Uploaders must enter it before they can send anything."}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" minLength={4} value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {existing?.hasPassword && <Checkbox label="Remove the password" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} />}
        <Checkbox label="Notify me when someone uploads" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        {branding ? (
          <fieldset className="space-y-3 rounded-lg border border-line p-3">
            <legend className="px-1 text-[13px] font-medium">Branding</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Your name or company" optional error={fields.brandName}>
                {(p) => <Input {...p} maxLength={60} value={brandName} onChange={(e) => setBrandName(e.target.value)} />}
              </Field>
              <Field label="Accent colour" optional hint="Hex, like #2f6f5e" error={fields.accent}>
                {(p) => <Input {...p} maxLength={7} placeholder="#2f6f5e" value={accent} onChange={(e) => setAccent(e.target.value)} />}
              </Field>
            </div>
            <Field label="Welcome message" optional>
              {(p) => <Textarea {...p} rows={2} maxLength={1000} value={welcome} onChange={(e) => setWelcome(e.target.value)} />}
            </Field>
          </fieldset>
        ) : (
          <p className="text-xs text-subtle">Custom branding isn&apos;t part of {plan.name}. Requests show Cairn&apos;s default look.</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            {existing ? "Save changes" : "Create request"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function RequestsManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const canShare = useCan("share");
  const enabled = useHasFeature("fileRequests");
  const res = useResource<{ items: FileRequestDto[] }>("requests", (signal) => api<{ items: FileRequestDto[] }>("/api/v1/requests", { signal }));
  const [dialog, setDialog] = useState<{ existing: FileRequestDto | null } | null>(null);
  const items = res.data?.items ?? null;

  const toggle = async (r: FileRequestDto) => {
    try {
      await api(`/api/v1/requests/${r.id}`, { method: "PATCH", body: { closed: !r.closedAt } });
      toast.success(r.closedAt ? "Request reopened" : "Request closed");
      res.reload();
    } catch (err) {
      toast.error("Couldn't update the request", errorMessage(err));
    }
  };
  const remove = async (r: FileRequestDto) => {
    if (!(await confirm({ title: `Delete “${r.name}”?`, description: `The link stops working. ${r.uploadCount ? `The ${pluralize(r.uploadCount, "file")} already received stay in your storage.` : ""}`, confirmLabel: "Delete request", tone: "danger" }))) return;
    try {
      await api(`/api/v1/requests/${r.id}`, { method: "DELETE" });
      toast.success("Request deleted");
      res.reload();
    } catch (err) {
      toast.error("Couldn't delete the request", errorMessage(err));
    }
  };

  if (!enabled) return <FeatureGate feature="fileRequests">{null}</FeatureGate>;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[13px] text-muted">Collect files from people who don&apos;t have an account. They get a link, not access. Everything they send is scanned and checked against the limits you set.</p>
        {canShare && (
          <Button variant="primary" onClick={() => setDialog({ existing: null })} icon={<Plus className="size-4" aria-hidden />}>
            New request
          </Button>
        )}
      </div>
      {res.error && <ErrorNotice className="mb-3">{res.error}</ErrorNotice>}
      {!items && !res.error ? (
        <div className="space-y-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : items && items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<Inbox />} title="No file requests yet" description="Create a request to let clients, students or colleagues send you files with nothing more than a link." />
        </div>
      ) : (
        <ul className="space-y-3">
          {items?.map((r) => (
            <li key={r.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {r.name}
                    <Badge tone={STATE_TONE[r.state]}>{r.state}</Badge>
                    <Badge>{r.kind === "portal" ? "Portal" : "Request"}</Badge>
                    {r.hasPassword && (
                      <Badge icon={<Lock className="size-3" aria-hidden />}>Password</Badge>
                    )}
                  </h3>
                  {r.description && <p className="mt-0.5 text-[13px] text-muted">{r.description}</p>}
                  <p className="mt-2 text-xs text-subtle tnum">
                    {pluralize(r.uploadCount, "file")} received · {formatBytes(r.totalBytes)}
                    {r.maxFiles ? ` of ${r.maxFiles} files` : ""}
                    {r.maxTotalBytes ? ` of ${formatBytes(r.maxTotalBytes)}` : ""} · into{" "}
                    {r.folderId ? (
                      <Link href={`/files?folder=${r.folderId}`} className="text-accent hover:underline">
                        {r.folderName ?? "folder"}
                      </Link>
                    ) : (
                      <Link href="/files" className="text-accent hover:underline">
                        top level
                      </Link>
                    )}
                    {r.expiresAt && ` · ${r.state === "expired" ? "expired" : "expires"} ${r.state === "expired" ? formatDateTime(r.expiresAt) : timeUntil(r.expiresAt)}`}
                  </p>
                </div>
                {canShare && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CopyButton value={r.url} label="Copy link" />
                    <Button size="sm" onClick={() => setDialog({ existing: r })} icon={<Pencil className="size-4" aria-hidden />}>
                      Edit
                    </Button>
                    <Button size="sm" onClick={() => toggle(r)} icon={<Power className="size-4" aria-hidden />}>
                      {r.closedAt ? "Reopen" : "Close"}
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => remove(r)}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-2 truncate font-mono text-xs text-subtle">{r.url}</p>
            </li>
          ))}
        </ul>
      )}
      {dialog && <RequestDialog existing={dialog.existing} onClose={() => setDialog(null)} onSaved={res.reload} />}
    </div>
  );
}
