"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";

export interface PrefRow {
  type: string;
  label: string;
  description: string;
  security: boolean;
}
type Prefs = { inApp: Record<string, boolean>; email: Record<string, boolean> };

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

export function NotificationPrefs({ rows, initial, emailConfigured }: { rows: PrefRow[]; initial: Prefs; emailConfigured: boolean }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [saved, setSaved] = useState<Prefs>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);

  const set = (channel: "inApp" | "email", type: string, value: boolean) => setPrefs((p) => ({ ...p, [channel]: { ...p[channel], [type]: value } }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/account/profile", { method: "PATCH", body: { prefs: { notifications: prefs } } });
      setSaved(prefs);
      toast.success("Notification settings saved");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {error && <ErrorNotice className="mb-3">{error}</ErrorNotice>}
      {!emailConfigured && <ErrorNotice tone="info" className="mb-3">Email delivery isn&apos;t set up on this installation yet, so email notifications are queued but not sent. In-app notifications work normally.</ErrorNotice>}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Notification preferences</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-subtle">
              <th scope="col" className="px-4 py-2 font-medium">
                When…
              </th>
              <th scope="col" className="w-20 px-2 py-2 text-center font-medium">
                In app
              </th>
              <th scope="col" className="w-20 px-2 py-2 text-center font-medium">
                Email
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.type}>
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <span className="flex items-center gap-1.5 font-medium">
                    {r.label}
                    {r.security && <Lock className="size-3 text-subtle" aria-label="Always on" />}
                  </span>
                  <span className="block text-xs text-muted">{r.description}</span>
                </th>
                <td className="px-2 text-center">
                  <Toggle label={`${r.label}: in app`} checked={r.security || prefs.inApp[r.type] !== false} disabled={r.security} onChange={(v) => set("inApp", r.type, v)} />
                </td>
                <td className="px-2 text-center">
                  <Toggle label={`${r.label}: email`} checked={r.security || prefs.email[r.type] === true} disabled={r.security} onChange={(v) => set("email", r.type, v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-subtle">Security notifications are always on so you never miss something risky.</p>
      <div className="mt-4">
        <Button variant="primary" onClick={save} loading={busy} disabled={!dirty}>
          Save preferences
        </Button>
      </div>
    </div>
  );
}
