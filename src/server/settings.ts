import { z } from "zod";
import { db } from "./db";

const MB = 1024 ** 2;
const GB = 1024 ** 3;

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) => z.number().int().min(min).max(max).default(def);
const rule = (limit: number, windowSec: number) =>
  z.object({ limit: int(limit, 1), windowSec: int(windowSec, 1) }).prefault({ limit, windowSec });
const ext = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]{1,16}$/, "Extensions may only contain letters and digits (without the dot).");

/**
 * Site-wide operational settings, editable by administrators. Anything that varies per customer
 * (storage, file size, feature access, retention) belongs to plans instead: see src/config.
 */
export const settingsSchema = z.object({
  uploads: z
    .object({
      chunkSizeBytes: int(8 * MB, 256 * 1024, 64 * MB),
      clientConcurrency: int(3, 1, 8),
      sessionTtlHours: int(48, 1, 24 * 30),
      maxActiveUploads: int(25, 1, 500),
    })
    .prefault({}),
  files: z
    .object({
      allowedExtensions: z.array(ext).default([]), // empty = everything not blocked
      blockedExtensions: z.array(ext).default(["scr", "pif", "vbs", "vbe", "wsf", "wsh", "hta", "cpl", "lnk"]),
      archiveMaxBytes: int(20 * GB, MB),
      archiveTtlHours: int(24, 1, 24 * 30),
      previewTextMaxBytes: int(256 * 1024, 1024, 4 * MB),
      exportTtlHours: int(48, 1, 24 * 30),
    })
    .prefault({}),
  rateLimits: z
    .object({
      upload: rule(600, 3600),
      requestUpload: rule(40, 3600),
      chunk: rule(4000, 60),
      download: rule(240, 60),
      login: rule(20, 300),
      loginPerAccount: rule(6, 900),
      register: rule(8, 3600),
      passwordReset: rule(5, 3600),
      shareUnlock: rule(8, 300),
      api: rule(600, 60),
      shareCreate: rule(120, 3600),
      report: rule(6, 3600),
      supportTicket: rule(10, 3600),
      webhookTest: rule(20, 3600),
    })
    .prefault({}),
  quota: z
    .object({
      warnPercents: z.array(z.number().int().min(1).max(100)).default([75, 85, 95, 100]),
    })
    .prefault({}),
  registration: z.object({ enabled: z.boolean().default(true) }).prefault({}),
  sessions: z.object({ ttlDays: int(30, 1, 365) }).prefault({}),
  maintenance: z
    .object({
      enabled: z.boolean().default(false),
      message: z.string().max(500).default("Cairn is undergoing maintenance. Please check back shortly."),
      disableUploads: z.boolean().default(true),
      allowDownloads: z.boolean().default(true),
    })
    .prefault({}),
  scanner: z
    .object({
      provider: z.enum(["none", "clamav"]).default("none"),
      host: z.string().max(255).default("127.0.0.1"),
      port: int(3310, 1, 65535),
      timeoutMs: int(120_000, 1000),
      maxBytes: int(2 * GB, MB),
      onError: z.enum(["allow", "quarantine"]).default("allow"),
    })
    .prefault({}),
  webhooks: z
    .object({
      timeoutMs: int(10_000, 1000, 60_000),
      maxAttempts: int(6, 1, 12),
      allowPrivateNetworks: z.boolean().default(false),
    })
    .prefault({}),
  billing: z
    .object({
      provider: z.enum(["none", "stripe"]).default("none"),
      trialDays: int(0, 0, 90),
    })
    .prefault({}),
  backups: z
    .object({
      enabled: z.boolean().default(false),
      keep: int(7, 1, 90),
    })
    .prefault({}),
  support: z.object({ contactEmail: z.string().max(200).default("") }).prefault({}),
});

export type Settings = z.infer<typeof settingsSchema>;
export type RateRule = { limit: number; windowSec: number };

const KEY = "config";
const globalForSettings = globalThis as unknown as { __cairnSettings?: { value: Settings; at: number } };

export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}

export async function getSettings(): Promise<Settings> {
  const cached = globalForSettings.__cairnSettings;
  if (cached && Date.now() - cached.at < 3000) return cached.value;
  const row = await db.systemSetting.findUnique({ where: { key: KEY } });
  let parsed: Settings;
  try {
    // Older rows may carry keys that no longer exist (e.g. guest limits); zod drops unknown keys.
    parsed = settingsSchema.parse(row ? JSON.parse(row.value) : {});
  } catch {
    parsed = defaultSettings();
  }
  globalForSettings.__cairnSettings = { value: parsed, at: Date.now() };
  return parsed;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObject(base) || !isObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
  return out;
}

export async function updateSettings(patch: unknown, updatedById: string): Promise<Settings> {
  const current = await getSettings();
  const merged = settingsSchema.parse(deepMerge(current, patch));
  await db.systemSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(merged), updatedById },
    update: { value: JSON.stringify(merged), updatedById },
  });
  globalForSettings.__cairnSettings = { value: merged, at: Date.now() };
  return merged;
}

export function invalidateSettingsCache() {
  globalForSettings.__cairnSettings = undefined;
}
