"use client";

import { Save } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Badge, Card, CardHeader, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { Settings } from "@/server/settings";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

function Num({ label, value, onChange, unit, hint, min = 0, step }: { label: string; value: number; onChange: (v: number) => void; unit?: number; hint?: string; min?: number; step?: string }) {
  const u = unit ?? 1;
  const shown = Number((value / u).toFixed(3));
  return (
    <Field label={label} hint={hint}>
      {(p) => (
        <Input
          {...p}
          type="number"
          inputMode="decimal"
          min={min}
          step={step ?? "any"}
          value={Number.isFinite(shown) ? shown : ""}
          onChange={(e) => onChange(Math.max(min, Math.round(Number(e.target.value || 0) * u)))}
        />
      )}
    </Field>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

const RATE_LABELS: Record<string, string> = {
  upload: "Upload sessions started",
  requestUpload: "File request uploads (per network address)",
  passwordReset: "Password reset requests",
  supportTicket: "Support tickets",
  webhookTest: "Webhook test sends",
  chunk: "Chunk requests",
  download: "Downloads",
  login: "Sign-in attempts per IP",
  loginPerAccount: "Failed sign-ins per account",
  register: "Registrations per IP",
  shareUnlock: "Link password attempts",
  api: "API requests",
  shareCreate: "Share link creation",
  report: "Abuse reports",
};

const list = (s: string) => s.split(/[\s,]+/).map((x) => x.replace(/^\./, "").toLowerCase()).filter(Boolean);

export function AdminSettings() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [allowed, setAllowed] = useState("");
  const [blocked, setBlocked] = useState("");
  const [warn, setWarn] = useState("");

  useEffect(() => {
    api<{ settings: Settings; updatedAt: string | null }>("/api/v1/admin/settings").then(
      (r) => {
        setS(r.settings);
        setUpdatedAt(r.updatedAt);
        setAllowed(r.settings.files.allowedExtensions.join(", "));
        setBlocked(r.settings.files.blockedExtensions.join(", "));
        setWarn(r.settings.quota.warnPercents.join(", "));
      },
      (e) => setError(errorMessage(e)),
    );
  }, []);

  if (error && !s) return <ErrorNotice>{error}</ErrorNotice>;
  if (!s) return <Skeleton className="h-96" />;

  const patch = (fn: (draft: Settings) => void) => {
    const next = structuredClone(s);
    fn(next);
    setS(next);
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const body: Settings = structuredClone(s);
    body.files.allowedExtensions = list(allowed);
    body.files.blockedExtensions = list(blocked);
    body.quota.warnPercents = warn
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0 && n <= 100);
    try {
      const res = await api<{ settings: Settings }>("/api/v1/admin/settings", { method: "PUT", body });
      setS(res.settings);
      setUpdatedAt(new Date().toISOString());
      setDirty(false);
      toast.success("Settings saved", "Changes apply immediately.");
    } catch (err) {
      setError(err instanceof ApiClientError && Array.isArray(err.details) ? `${err.message} ${(err.details as Array<{ path: string; message: string }>).map((d) => `${d.path}: ${d.message}`).join("; ")}` : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      {updatedAt && <p className="text-xs text-subtle">Last saved {formatDateTime(updatedAt)}</p>}
      {error && <ErrorNotice>{error}</ErrorNotice>}

      <Card>
        <CardHeader title="Maintenance mode" description="Show a banner and optionally pause uploads or downloads. Administration always stays available." />
        <div className="space-y-3 p-4">
          <Checkbox checked={s.maintenance.enabled} onChange={(e) => patch((d) => void (d.maintenance.enabled = e.target.checked))} label="Enable maintenance mode" />
          <Field label="Message shown to visitors">{(p) => <Textarea {...p} rows={2} maxLength={500} value={s.maintenance.message} onChange={(e) => patch((d) => void (d.maintenance.message = e.target.value))} />}</Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox checked={s.maintenance.disableUploads} onChange={(e) => patch((d) => void (d.maintenance.disableUploads = e.target.checked))} label="Disable new uploads" />
            <Checkbox checked={s.maintenance.allowDownloads} onChange={(e) => patch((d) => void (d.maintenance.allowDownloads = e.target.checked))} label="Keep existing downloads available" />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Plans decide per-customer limits" description="Storage, file size, retention, API rate limits and features are set on plans, not here." />
        <div className="p-4 text-[13px] text-muted">
          Edit prices, feature access and limits in <a className="font-medium text-accent hover:underline" href="/admin/plans">Administration → Plans</a>. This page holds the settings that apply to everyone.
        </div>
      </Card>
      <Card>
        <CardHeader title="Uploads" />
        <Grid>
          <Num label="Chunk size (MB)" unit={MB} value={s.uploads.chunkSizeBytes} onChange={(v) => patch((d) => void (d.uploads.chunkSizeBytes = v))} min={0.25} />
          <Num label="Parallel chunks per file" value={s.uploads.clientConcurrency} onChange={(v) => patch((d) => void (d.uploads.clientConcurrency = v))} min={1} hint="Upload concurrency used by the browser (1–8)." />
          <Num label="Upload session lifetime (hours)" value={s.uploads.sessionTtlHours} onChange={(v) => patch((d) => void (d.uploads.sessionTtlHours = v))} min={1} hint="Unfinished uploads can be resumed for this long." />
          <Num label="Active uploads per user" value={s.uploads.maxActiveUploads} onChange={(v) => patch((d) => void (d.uploads.maxActiveUploads = v))} min={1} />
        </Grid>
      </Card>

      <Card>
        <CardHeader title="File types & retention" />
        <div className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Allowed extensions" hint="Comma separated, without dots. Leave empty to allow everything that isn't blocked.">
              {(p) => <Textarea {...p} rows={2} value={allowed} onChange={(e) => (setAllowed(e.target.value), setDirty(true))} placeholder="e.g. jpg, png, pdf" />}
            </Field>
            <Field label="Blocked extensions" hint="Always rejected, even if allowed above.">
              {(p) => <Textarea {...p} rows={2} value={blocked} onChange={(e) => (setBlocked(e.target.value), setDirty(true))} />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Num label="Max ZIP size (GB)" unit={GB} value={s.files.archiveMaxBytes} onChange={(v) => patch((d) => void (d.files.archiveMaxBytes = v))} min={0.001} />
            <Num label="ZIP lifetime (hours)" value={s.files.archiveTtlHours} onChange={(v) => patch((d) => void (d.files.archiveTtlHours = v))} min={1} />
            <Num label="Text preview limit (KB)" unit={KB} value={s.files.previewTextMaxBytes} onChange={(v) => patch((d) => void (d.files.previewTextMaxBytes = v))} min={1} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Malware scanner" description="Files are only marked “scanned” when a scanner actually scanned them." />
        <div className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Provider">
              {(p) => (
                <Select {...p} value={s.scanner.provider} onChange={(e) => patch((d) => void (d.scanner.provider = e.target.value as Settings["scanner"]["provider"]))}>
                  <option value="none">None — files are recorded as not scanned</option>
                  <option value="clamav">ClamAV (clamd over TCP)</option>
                </Select>
              )}
            </Field>
            <Field label="clamd host">{(p) => <Input {...p} value={s.scanner.host} disabled={s.scanner.provider === "none"} onChange={(e) => patch((d) => void (d.scanner.host = e.target.value))} />}</Field>
            <Num label="clamd port" value={s.scanner.port} onChange={(v) => patch((d) => void (d.scanner.port = v))} min={1} />
            <Num label="Timeout (seconds)" unit={1000} value={s.scanner.timeoutMs} onChange={(v) => patch((d) => void (d.scanner.timeoutMs = v))} min={1} />
            <Num label="Largest file to scan (GB)" unit={GB} value={s.scanner.maxBytes} onChange={(v) => patch((d) => void (d.scanner.maxBytes = v))} min={0.001} hint="Bigger files are stored as not scanned." />
            <Field label="If the scanner fails">
              {(p) => (
                <Select {...p} value={s.scanner.onError} onChange={(e) => patch((d) => void (d.scanner.onError = e.target.value as "allow" | "quarantine"))}>
                  <option value="allow">Allow the file (marked “scan failed”)</option>
                  <option value="quarantine">Quarantine the file</option>
                </Select>
              )}
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Accounts & sessions" />
        <Grid>
          <div className="pt-6">
            <Checkbox checked={s.registration.enabled} onChange={(e) => patch((d) => void (d.registration.enabled = e.target.checked))} label="Allow new registrations" />
          </div>
          <Num label="Session lifetime (days)" value={s.sessions.ttlDays} onChange={(v) => patch((d) => void (d.sessions.ttlDays = v))} min={1} hint="Sliding: renewed while the user is active." />
          <Field label="Quota warning thresholds (%)" hint="Users are notified when they cross these.">
            {(p) => <Input {...p} value={warn} onChange={(e) => (setWarn(e.target.value), setDirty(true))} />}
          </Field>
        </Grid>
      </Card>

      <Card>
        <CardHeader title="Rate limits" description="Requests allowed per window. Keyed by account or API key where possible, with IP as a fallback." />
        <div role="region" aria-label="Settings table" tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-[13px]">
            <thead className="border-b border-line text-xs text-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Limit</th>
                <th className="px-3 py-2 font-medium">Requests</th>
                <th className="px-3 py-2 font-medium">Window (seconds)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(Object.keys(s.rateLimits) as Array<keyof Settings["rateLimits"]>).map((k) => (
                <tr key={k}>
                  <td className="px-4 py-2">{RATE_LABELS[k] ?? k}</td>
                  <td className="px-3 py-1.5">
                    <Input aria-label={`${RATE_LABELS[k]} requests`} className="h-8 w-28" type="number" min={1} value={s.rateLimits[k].limit} onChange={(e) => patch((d) => void (d.rateLimits[k].limit = Math.max(1, Number(e.target.value) || 1)))} />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input aria-label={`${RATE_LABELS[k]} window`} className="h-8 w-28" type="number" min={1} value={s.rateLimits[k].windowSec} onChange={(e) => patch((d) => void (d.rateLimits[k].windowSec = Math.max(1, Number(e.target.value) || 1)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Webhooks" description="Outbound deliveries are signed and retried with backoff." />
        <Grid>
          <Num label="Request timeout (seconds)" unit={1000} value={s.webhooks.timeoutMs} onChange={(v) => patch((d) => void (d.webhooks.timeoutMs = v))} min={1} />
          <Num label="Delivery attempts" value={s.webhooks.maxAttempts} onChange={(v) => patch((d) => void (d.webhooks.maxAttempts = v))} min={1} />
          <div className="pt-6">
            <Checkbox checked={s.webhooks.allowPrivateNetworks} onChange={(e) => patch((d) => void (d.webhooks.allowPrivateNetworks = e.target.checked))} label="Allow private network targets" />
            <p className="mt-1 text-xs text-subtle">Only for trusted internal deployments. Leave off to block requests to internal addresses.</p>
          </div>
        </Grid>
      </Card>

      <Card>
        <CardHeader title="Billing" description="With no provider, plans are assigned by administrators and nothing is charged." />
        <Grid>
          <Field label="Provider">
            {(p) => (
              <Select {...p} value={s.billing.provider} onChange={(e) => patch((d) => void (d.billing.provider = e.target.value as "none" | "stripe"))}>
                <option value="none">None (administrator-assigned plans)</option>
                <option value="stripe">Stripe (needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET)</option>
              </Select>
            )}
          </Field>
        </Grid>
      </Card>

      <Card>
        <CardHeader title="Backups" description="Database backups (VACUUM INTO). File blobs live in the storage provider and need their own backup." />
        <Grid>
          <div className="pt-6">
            <Checkbox checked={s.backups.enabled} onChange={(e) => patch((d) => void (d.backups.enabled = e.target.checked))} label="Back up the database daily" />
          </div>
          <Num label="Backups to keep" value={s.backups.keep} onChange={(v) => patch((d) => void (d.backups.keep = v))} min={1} />
        </Grid>
      </Card>

      <Card>
        <CardHeader title="Support" />
        <div className="p-4">
          <Field label="Contact email" hint="Tickets are also forwarded here when an email provider is configured.">
            {(p) => <Input {...p} type="email" value={s.support.contactEmail} onChange={(e) => patch((d) => void (d.support.contactEmail = e.target.value))} />}
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Storage" />
        <div className="p-4 text-[13px] text-muted">
          Active provider: <Badge tone="accent">local disk</Badge> — blobs are stored under generated keys in the server&apos;s data directory. The storage layer is an interface, so an S3-compatible provider can be added without touching the rest of the application.
        </div>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="text-[13px] text-muted">{dirty ? "You have unsaved changes." : "All changes saved."}</p>
          <Button variant="primary" onClick={save} loading={busy} disabled={!dirty} icon={<Save className="size-4" aria-hidden />}>
            Save settings
          </Button>
        </div>
      </div>
    </div>
  );
}
