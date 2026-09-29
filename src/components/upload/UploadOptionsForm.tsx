"use client";

import { Field, Input, Select } from "@/components/ui/Field";
import { Checkbox } from "@/components/ui/Field";
import { expiryChoices, type UploadFormState } from "@/lib/upload/options";
import type { LimitsDto } from "@/lib/types";

interface Props {
  value: UploadFormState;
  onChange: (next: UploadFormState) => void;
  limits: LimitsDto;
  /** Registered users can choose to upload without creating a public link. */
  allowPrivate?: boolean;
  idPrefix?: string;
}

export function UploadOptionsForm({ value, onChange, limits, allowPrivate = true }: Props) {
  const set = <K extends keyof UploadFormState>(k: K, v: UploadFormState[K]) => onChange({ ...value, [k]: v });
  const choices = expiryChoices(limits);
  return (
    <div className="space-y-3.5">
      <Field label="Delete after" hint={limits.maxRetentionDays > 0 ? `Your plan allows at most ${limits.maxRetentionDays} days.` : undefined}>
        {(p) => (
          <Select {...p} value={value.expiry} onChange={(e) => set("expiry", e.target.value)}>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Password" optional hint="Visitors must enter it to see or download the file.">
        {(p) => <Input {...p} type="password" autoComplete="new-password" minLength={4} maxLength={128} value={value.password} onChange={(e) => set("password", e.target.value)} placeholder="No password" />}
      </Field>
      <Field label="Download limit" optional hint="The link stops working after this many downloads.">
        {(p) => <Input {...p} inputMode="numeric" pattern="[0-9]*" value={value.maxDownloads} onChange={(e) => set("maxDownloads", e.target.value.replace(/[^0-9]/g, "").slice(0, 7))} placeholder="Unlimited" />}
      </Field>
      {allowPrivate && <Checkbox checked={value.share} onChange={(e) => set("share", e.target.checked)} label="Create a public link" />}
    </div>
  );
}
