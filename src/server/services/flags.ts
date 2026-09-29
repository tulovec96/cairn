import { FLAGS, FLAG_KEYS, type FlagKey } from "@/config/flags";
import { db } from "../db";
import { Errors } from "../errors";

const g = globalThis as unknown as { __cairnFlags?: { at: number; map: Map<string, boolean> } };

async function load(): Promise<Map<string, boolean>> {
  const cached = g.__cairnFlags;
  if (cached && Date.now() - cached.at < 3000) return cached.map;
  const rows = await db.featureFlag.findMany();
  const map = new Map(rows.map((r) => [r.key, r.enabled]));
  g.__cairnFlags = { at: Date.now(), map };
  return map;
}

export async function isEnabled(key: FlagKey): Promise<boolean> {
  return (await load()).get(key) ?? true;
}

export async function assertFlag(key: FlagKey): Promise<void> {
  if (!(await isEnabled(key))) throw Errors.featureDisabled(FLAGS[key].label);
}

export async function allFlags(): Promise<Array<{ key: FlagKey; label: string; description: string; enabled: boolean }>> {
  const map = await load();
  return FLAG_KEYS.map((key) => ({ key, ...FLAGS[key], enabled: map.get(key) ?? true }));
}

export async function setFlag(key: FlagKey, enabled: boolean): Promise<void> {
  await db.featureFlag.upsert({ where: { key }, create: { key, enabled, description: FLAGS[key].description }, update: { enabled } });
  g.__cairnFlags = undefined;
}
