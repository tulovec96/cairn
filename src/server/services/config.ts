import { db } from "../db";
import { getSettings } from "../settings";
import type { AuthedConfigDto, PublicConfigDto } from "@/lib/types";
import type { Actor } from "./actor";
import { getPlan } from "./entitlements";
import { limitsFor, usageFor } from "./limits";

/** Everything the upload UI needs to know: limits and usage for the current workspace. */
export async function buildPublicConfig(actor: Actor | null): Promise<PublicConfigDto> {
  const settings = await getSettings();
  let plan: PublicConfigDto["plan"] = null;
  if (actor) {
    const org = actor.workspace.orgId ? await db.organization.findUnique({ where: { id: actor.workspace.orgId }, select: { planKey: true } }) : null;
    const record = await getPlan(org?.planKey ?? actor.user.planKey).catch(() => null);
    plan = record ? { key: record.key, name: record.name } : null;
  }
  return {
    chunkSizeBytes: settings.uploads.chunkSizeBytes,
    clientConcurrency: settings.uploads.clientConcurrency,
    blockedExtensions: settings.files.blockedExtensions,
    allowedExtensions: settings.files.allowedExtensions,
    registrationEnabled: settings.registration.enabled,
    maintenance: settings.maintenance,
    scannerEnabled: settings.scanner.provider !== "none",
    plan,
    limits: actor ? await limitsFor(actor) : null,
    usage: actor ? await usageFor(actor) : null,
  };
}

export async function buildAuthedConfig(actor: Actor): Promise<AuthedConfigDto> {
  const config = await buildPublicConfig(actor);
  return { ...config, limits: config.limits!, usage: config.usage! };
}
