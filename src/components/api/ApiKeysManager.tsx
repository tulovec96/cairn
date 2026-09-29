"use client";

import { AlertTriangle, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { UpgradeNotice } from "@/components/common/Upgrade";
import { useAccount } from "@/components/layout/AccountContext";
import { formatLimit } from "@/config/entitlements";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field, Input, Select } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";
import { formatDateTime, timeAgo } from "@/lib/format";
import { SCOPES, type ApiKeyDto, type Scope } from "@/lib/types";
import { SCOPE_DOCS } from "@/lib/api-docs";

export function ApiKeysManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const res = useResource("api-keys", (signal) => api<{ items: ApiKeyDto[] }>("/api/v1/keys", { signal }));
  const keys = res.data?.items ?? null;
  const error = res.error;
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ key: string; name: string } | null>(null);

  const load = () => res.reload();

  const revoke = async (k: ApiKeyDto) => {
    if (!(await confirm({ title: `Revoke “${k.name}”?`, description: "Anything using this key stops working immediately. This can't be undone.", confirmLabel: "Revoke key", tone: "danger" }))) return;
    try {
      await api(`/api/v1/keys/${k.id}`, { method: "DELETE" });
      toast.success("Key revoked");
      void load();
    } catch (err) {
      toast.error("Couldn't revoke the key", errorMessage(err));
    }
  };

  const [loadedAt] = useState(() => Date.now());
  const active = (keys ?? []).filter((k) => !k.revokedAt && (!k.expiresAt || new Date(k.expiresAt).getTime() > loadedAt));
  const revoked = (keys ?? []).filter((k) => k.revokedAt);
  const { plan } = useAccount();
  const canUseApi = plan.features.api;
  const keyLimit = plan.limits.apiKeys;
  const atLimit = keyLimit >= 0 && active.length >= keyLimit;

  return (
    <div>
      {!canUseApi && <UpgradeNotice feature="api" className="mb-4" />}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted tnum">
          {active.length} of {formatLimit("apiKeys", keyLimit)} active keys · {formatLimit("apiRequestsPerMinute", plan.limits.apiRequestsPerMinute)}
        </p>
        <Button variant="primary" onClick={() => setCreating(true)} disabled={!canUseApi || atLimit} icon={<Plus className="size-4" aria-hidden />}>
          Create key
        </Button>
      </div>
      {canUseApi && atLimit && <ErrorNotice tone="warning" className="mb-3">You&apos;ve reached your plan&apos;s limit of {keyLimit} active keys. Revoke one to create another.</ErrorNotice>}
      {error && <ErrorNotice className="mb-3">{error}</ErrorNotice>}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {!keys ? (
          <div className="divide-y divide-line">
            {[0, 1].map((i) => (
              <div key={i} className="px-4 py-4">
                <Skeleton className="h-4 w-1/3" />
              </div>
            ))}
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            icon={<KeyRound />}
            title="No API keys"
            description="Keys let scripts and apps upload, download and share files as you. Each key has its own permissions."
            action={
              <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" aria-hidden />}>
                Create your first key
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {active.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate text-[13px] font-medium">{k.name}</p>
                  <p className="font-mono text-xs text-muted">{k.prefix}…</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {k.scopes.map((s) => (
                    <Badge key={s}>
                      <span className="font-mono">{s}</span>
                    </Badge>
                  ))}
                </div>
                <div className="text-xs text-muted">
                  <p>Created {formatDateTime(k.createdAt)}</p>
                  <p>{k.lastUsedAt ? `Last used ${timeAgo(k.lastUsedAt)}` : "Never used"}</p>
                  {k.expiresAt && <p>Expires {formatDateTime(k.expiresAt)}</p>}
                </div>
                <Button size="sm" variant="danger-outline" onClick={() => revoke(k)} icon={<Trash2 className="size-3.5" aria-hidden />}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {revoked.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-[13px] font-medium text-muted hover:text-fg">Revoked keys ({revoked.length})</summary>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
            {revoked.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] opacity-70">
                <span>
                  {k.name} <span className="font-mono text-xs text-muted">{k.prefix}…</span>
                </span>
                <span className="text-xs text-muted">Revoked {k.revokedAt ? timeAgo(k.revokedAt) : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {creating && (
        <CreateKeyDialog
          onClose={() => setCreating(false)}
          onCreated={(key, name) => {
            setCreating(false);
            setSecret({ key, name });
            void load();
          }}
        />
      )}
      {secret && (
        <Modal
          open
          onOpenChange={(o) => !o && setSecret(null)}
          title="Copy your new API key"
          size="lg"
          footer={
            <Button variant="primary" onClick={() => setSecret(null)}>
              I&apos;ve saved it
            </Button>
          }
        >
          <div className="space-y-3">
            <ErrorNotice tone="warning">
              <span className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                This is the only time the full key is shown. Only a hash is stored, so it can&apos;t be recovered — if you lose it, revoke it and create a new one.
              </span>
            </ErrorNotice>
            <p className="text-[13px] text-muted">Key “{secret.name}”</p>
            <div className="flex items-center gap-2">
              <input readOnly aria-label="API key" value={secret.key} onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-3 font-mono text-xs" />
              <CopyButton value={secret.key} variant="primary" size="md" label="Copy key" successMessage="Key copied" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreateKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string, name: string) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<Scope>>(new Set(["files:read", "files:write"]));
  const [expires, setExpires] = useState("never");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!scopes.size) return setError("Select at least one permission.");
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ key: string }>("/api/v1/keys", {
        method: "POST",
        body: { name: name.trim(), scopes: [...scopes], ...(expires !== "never" ? { expiresInDays: Number(expires) } : { expiresInDays: null }) },
      });
      onCreated(res.key, name.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Create API key" size="md">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Field label="Name" hint="Something you'll recognize later, e.g. “backup script”.">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />}
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium">Permissions</legend>
          {SCOPES.map((s) => (
            <label key={s} className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line p-2.5 hover:bg-surface-2">
              <input
                type="checkbox"
                checked={scopes.has(s)}
                onChange={(e) =>
                  setScopes((prev) => {
                    const n = new Set(prev);
                    if (e.target.checked) n.add(s);
                    else n.delete(s);
                    return n;
                  })
                }
                className="mt-0.5 size-4 accent-[var(--accent)]"
              />
              <span>
                <span className="block font-mono text-xs font-medium">{s}</span>
                <span className="block text-xs text-muted">{SCOPE_DOCS.find((d) => d.scope === s)?.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label="Expires">
          {(p) => (
            <Select {...p} value={expires} onChange={(e) => setExpires(e.target.value)}>
              <option value="never">Never</option>
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In 1 year</option>
            </Select>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            Create key
          </Button>
        </div>
      </form>
    </Modal>
  );
}
