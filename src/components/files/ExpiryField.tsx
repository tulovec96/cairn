"use client";

import { Field, Input, Select } from "@/components/ui/Field";
import { EXPIRY_PRESETS } from "@/lib/upload/options";
import type { LimitsDto } from "@/lib/types";

export type ExpiryValue = { choice: string; custom: string };

export const DEFAULT_EXPIRY: ExpiryValue = { choice: "keep", custom: "" };

/** Resolves the picker state to what the API expects: ISO string, null (never) or undefined (leave unchanged). */
export function expiryValueToApi(v: ExpiryValue): string | null | undefined {
  if (v.choice === "keep") return undefined;
  if (v.choice === "never") return null;
  if (v.choice === "custom") return v.custom ? new Date(v.custom).toISOString() : undefined;
  const preset = EXPIRY_PRESETS.find((p) => p.value === v.choice);
  return preset ? new Date(Date.now() + preset.ms).toISOString() : undefined;
}

interface Props {
  value: ExpiryValue;
  onChange: (v: ExpiryValue) => void;
  label?: string;
  limits?: LimitsDto;
  /** Offer a "keep current" option (default) */
  allowKeep?: boolean;
  allowNever?: boolean;
  keepLabel?: string;
  hint?: string;
  error?: string | null;
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ExpiryField({ value, onChange, label = "Expires", limits, allowKeep = true, allowNever = true, keepLabel = "Keep as is", hint, error }: Props) {
  const maxMs = limits && limits.maxRetentionDays > 0 ? limits.maxRetentionDays * 86400_000 : null;
  const presets = EXPIRY_PRESETS.filter((p) => maxMs === null || p.ms <= maxMs);
  const neverOk = allowNever && (limits ? limits.allowNever : true);
  return (
    <div className="space-y-2">
      <Field label={label} hint={hint} error={error}>
        {(p) => (
          <Select {...p} value={value.choice} onChange={(e) => onChange({ ...value, choice: e.target.value })}>
            {allowKeep && <option value="keep">{keepLabel}</option>}
            {presets.map((x) => (
              <option key={x.value} value={x.value}>
                In {x.label}
              </option>
            ))}
            <option value="custom">Pick a date and time…</option>
            {neverOk && <option value="never">Never</option>}
          </Select>
        )}
      </Field>
      {value.choice === "custom" && (
        <Field label="Date and time">
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              ref={(el) => {
                // Bounds depend on "now", so they are applied imperatively rather than during render.
                if (!el) return;
                el.min = toLocalInput(new Date(Date.now() + 5 * 60_000));
                if (maxMs) el.max = toLocalInput(new Date(Date.now() + maxMs));
              }}
              value={value.custom}
              onChange={(e) => onChange({ ...value, custom: e.target.value })}
              required
            />
          )}
        </Field>
      )}
    </div>
  );
}
