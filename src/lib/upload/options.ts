import type { LimitsDto } from "../types";
import type { UploadOptions } from "./engine";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export const EXPIRY_PRESETS = [
  { value: "1h", label: "1 hour", ms: HOUR },
  { value: "1d", label: "1 day", ms: DAY },
  { value: "7d", label: "7 days", ms: 7 * DAY },
  { value: "30d", label: "30 days", ms: 30 * DAY },
  { value: "90d", label: "90 days", ms: 90 * DAY },
  { value: "365d", label: "1 year", ms: 365 * DAY },
] as const;

export interface UploadFormState {
  expiry: string; // "default" | preset value | "never"
  password: string;
  maxDownloads: string;
  share: boolean;
}

export function defaultRetentionLabel(limits: LimitsDto): string {
  void limits;
  return "Never expires";
}

export function expiryChoices(limits: LimitsDto): Array<{ value: string; label: string }> {
  const choices = [{ value: "default", label: `Default (${defaultRetentionLabel(limits)})` }];
  for (const p of EXPIRY_PRESETS) {
    if (limits.maxRetentionDays > 0 && p.ms > limits.maxRetentionDays * DAY) continue;
    choices.push({ value: p.value, label: p.label });
  }
  if (limits.allowNever) choices.push({ value: "never", label: "Never" });
  return choices;
}

export function expiryToIso(choice: string): string | null | undefined {
  if (choice === "default") return undefined;
  if (choice === "never") return null;
  const preset = EXPIRY_PRESETS.find((p) => p.value === choice);
  return preset ? new Date(Date.now() + preset.ms).toISOString() : undefined;
}

export function toUploadOptions(state: UploadFormState, opts: { folderId?: string | null }): UploadOptions {
  const max = Number.parseInt(state.maxDownloads, 10);
  return {
    ...(opts.folderId !== undefined ? { folderId: opts.folderId } : {}),
    share: state.share,
    expiresAt: expiryToIso(state.expiry),
    password: state.password.trim() ? state.password.trim() : null,
    maxDownloads: Number.isFinite(max) && max > 0 ? max : null,
  };
}

export const DEFAULT_FORM: UploadFormState = { expiry: "default", password: "", maxDownloads: "", share: false };
