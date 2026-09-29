import type { User } from "@prisma/client";
import { db } from "../db";
import { Errors } from "../errors";
import { emit } from "../events";
import { getSettings } from "../settings";
import { formatBytes } from "@/lib/format";
import type { LimitsDto, UsageDto } from "@/lib/types";
import { isUnlimited } from "@/config/entitlements";
import { scopeWhere, scopeOf, workspaceIdOf, type Actor, type Scope } from "./actor";
import { assertFeature, assertLimit, entitlementsForOrg, entitlementsForUser, type Entitlements } from "./entitlements";
import { notify } from "./notifications";

const ACTIVE_UPLOAD = ["active", "finalizing"];

/** Entitlements of whichever workspace the actor is working in (their own plan, or the organization's). */
export async function entitlementsForActor(actor: Actor): Promise<Entitlements> {
  if (actor.workspace.orgId) {
    const org = await db.organization.findUnique({ where: { id: actor.workspace.orgId }, select: { id: true, planKey: true } });
    if (org) return entitlementsForOrg(org);
  }
  return entitlementsForUser(actor.user);
}

export async function entitlementsForScope(scope: Scope, owner?: Pick<User, "id" | "planKey" | "quotaBytes" | "maxFileBytes">): Promise<Entitlements> {
  if (scope.orgId) {
    const org = await db.organization.findUnique({ where: { id: scope.orgId }, select: { id: true, planKey: true } });
    if (org) return entitlementsForOrg(org);
  }
  const user = owner ?? (await db.user.findUniqueOrThrow({ where: { id: scope.userId }, select: { id: true, planKey: true, quotaBytes: true, maxFileBytes: true } }));
  return entitlementsForUser(user);
}

export function limitsFromEntitlements(ent: Entitlements): LimitsDto {
  return {
    maxFileBytes: ent.limits.maxFileBytes,
    quotaBytes: ent.limits.storageBytes,
    maxRetentionDays: ent.limits.maxRetentionDays,
    allowNever: isUnlimited(ent.limits.maxRetentionDays),
  };
}

export async function limitsFor(actor: Actor): Promise<LimitsDto> {
  return limitsFromEntitlements(await entitlementsForActor(actor));
}

/** Bytes used by a workspace: current files, previous versions and trash all occupy storage, plus uploads in flight. */
export async function storageUsedBytes(scope: Scope): Promise<{ stored: number; pending: number; files: number; pendingCount: number }> {
  const where = scopeWhere(scope);
  const [files, versions, pending, live] = await Promise.all([
    db.file.aggregate({ where, _sum: { size: true } }),
    db.fileVersion.aggregate({ where: { file: where }, _sum: { size: true } }),
    db.upload.aggregate({ where: { ...where, status: { in: ACTIVE_UPLOAD } }, _sum: { size: true }, _count: true }),
    db.file.count({ where: { ...where, deletedAt: null } }),
  ]);
  return {
    stored: Number(files._sum.size ?? 0n) + Number(versions._sum.size ?? 0n),
    pending: Number(pending._sum.size ?? 0n),
    files: live,
    pendingCount: pending._count,
  };
}

export async function usageForScope(scope: Scope, ent: Entitlements): Promise<UsageDto> {
  const u = await storageUsedBytes(scope);
  const usedBytes = u.stored + u.pending;
  const quota = ent.limits.storageBytes;
  return {
    usedBytes,
    quotaBytes: quota,
    fileCount: u.files + u.pendingCount,
    maxFileBytes: ent.limits.maxFileBytes,
    percent: isUnlimited(quota) || quota === 0 ? 0 : Math.min(100, (usedBytes / quota) * 100),
  };
}

export async function usageFor(actor: Actor): Promise<UsageDto> {
  return usageForScope(scopeOf(actor), await entitlementsForActor(actor));
}

export function checkExtension(settings: Awaited<ReturnType<typeof getSettings>>, ext: string) {
  const e = ext.toLowerCase();
  if (settings.files.blockedExtensions.includes(e)) throw Errors.blockedType(e);
  if (settings.files.allowedExtensions.length > 0 && !settings.files.allowedExtensions.includes(e)) throw Errors.blockedType(e || "unknown");
}

interface UploadCheck {
  size: number;
  ext: string;
  /** Skip the quota check for bytes that replace existing data (e.g. restoring a version). */
  replacingBytes?: number;
}

/** Every upload path (account uploads, file requests, imports) goes through this: server-side, plan-aware. */
export async function assertUploadAllowed(scope: Scope, ent: Entitlements, input: UploadCheck, opts?: { maxActive?: number }) {
  const settings = await getSettings();
  if (settings.maintenance.enabled && settings.maintenance.disableUploads) throw Errors.maintenance(settings.maintenance.message);
  if (!Number.isSafeInteger(input.size) || input.size <= 0) throw Errors.validation("Empty files can't be uploaded.");
  const maxFile = ent.limits.maxFileBytes;
  if (!isUnlimited(maxFile) && input.size > maxFile) throw Errors.fileTooLarge(formatBytes(maxFile));
  checkExtension(settings, input.ext);

  const activeUploads = await db.upload.count({ where: { ...scopeWhere(scope), status: "active" } });
  if (activeUploads >= (opts?.maxActive ?? settings.uploads.maxActiveUploads)) {
    throw Errors.conflict("Too many uploads are in progress. Wait for some to finish or cancel them.");
  }
  const used = await storageUsedBytes(scope);
  const quota = ent.limits.storageBytes;
  if (!isUnlimited(quota) && used.stored + used.pending + input.size > quota) {
    const free = Math.max(0, quota - used.stored - used.pending);
    throw Errors.quota(`Storage quota reached (${formatBytes(free)} free of ${formatBytes(quota)}). Delete files, empty the trash or upgrade your plan to make room.`);
  }
}

/**
 * Resolves the expiry for a new file.
 * Plans without a retention cap: no choice or "never" keep the file until the owner deletes it.
 * Plans with a cap: "never" is refused, and no choice means "as long as the plan allows".
 * A specific date is always validated against the plan.
 */
export function resolveExpiry(limits: LimitsDto, requested: Date | null | undefined, now = new Date()): Date | null {
  if (requested === undefined || requested === null) {
    if (isUnlimited(limits.maxRetentionDays)) return null;
    if (requested === null) throw Errors.validation(`Files can't be kept forever on your plan; the longest is ${limits.maxRetentionDays} days.`);
    return new Date(now.getTime() + limits.maxRetentionDays * 86400_000);
  }
  if (requested.getTime() < now.getTime() + 30_000) throw Errors.validation("The expiry time must be in the future.");
  if (!isUnlimited(limits.maxRetentionDays) && requested.getTime() > now.getTime() + limits.maxRetentionDays * 86400_000 + 60_000) {
    throw Errors.validation(`Files can be kept for at most ${limits.maxRetentionDays} days on your plan.`);
  }
  return requested;
}

/** Sends de-duplicated warnings when a workspace crosses a configured storage threshold. */
export async function checkQuotaWarning(scope: Scope, ent: Entitlements) {
  const settings = await getSettings();
  const usage = await usageForScope(scope, ent);
  if (isUnlimited(usage.quotaBytes)) return;
  const crossed = [...settings.quota.warnPercents].sort((a, b) => b - a).find((p) => usage.percent >= p);
  if (!crossed) return;
  const title = crossed >= 100 ? "Your storage is full" : `Storage is ${crossed}% full`;
  const body =
    crossed >= 100
      ? "New uploads are blocked until you free up space. Delete files, empty the trash or upgrade your plan."
      : `You've used ${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)}.`;
  const recipients = scope.orgId
    ? (await db.organizationMember.findMany({ where: { orgId: scope.orgId, role: { in: ["owner", "admin"] } }, select: { userId: true } })).map((m) => m.userId)
    : [scope.userId];
  for (const userId of recipients) {
    await notify({ userId, type: "storage_warning", title, body, href: "/analytics", dedupeKey: `quota:${workspaceIdOf(scope)}:${crossed}`, dedupeHours: 24 * 7 });
  }
  const fresh = await db.notification.count({ where: { userId: recipients[0], dedupeKey: `quota:${workspaceIdOf(scope)}:${crossed}`, createdAt: { gte: new Date(Date.now() - 5000) } } });
  if (fresh) await emit({ type: "storage.limit_reached", workspaceId: workspaceIdOf(scope), ownerId: scope.userId, orgId: scope.orgId, data: { percent: Math.round(usage.percent), threshold: crossed } });
}

export { assertFeature, assertLimit };
