import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { FEATURE_KEYS, LIMIT_KEYS, type PlanFeatures, type PlanLimits } from "@/config/entitlements";
import { db } from "../db";
import { Errors } from "../errors";
import { wakeWorker } from "../jobs/queue";
import { audit } from "./audit";
import { assignPlan, type Subject } from "./billing";
import { getPlan, invalidatePlanCache, listPlans } from "./entitlements";
import { confirmMalicious, releaseFile } from "./scanning";
import { serializeShare } from "./serializers";
import { backupDatabase } from "./ops";
import { destroyFiles } from "./files";
import { allFlags, setFlag } from "./flags";
import { FLAG_KEYS, type FlagKey } from "@/config/flags";
import { storageUsedBytes } from "./limits";

const page = (cursor?: string): { cursor?: { id: string }; skip?: number } => (cursor ? { cursor: { id: cursor }, skip: 1 } : {});
const cursorSchema = z.string().max(40).optional();

// ---- Organizations ----

export const adminOrgListSchema = z.object({ q: z.string().trim().max(100).optional(), cursor: cursorSchema, limit: z.coerce.number().int().min(1).max(100).default(30) });

export async function adminListOrgs(query: z.infer<typeof adminOrgListSchema>) {
  const rows = await db.organization.findMany({
    where: query.q ? { OR: [{ name: { contains: query.q } }, { slug: { contains: query.q.toLowerCase() } }, { id: query.q }] } : {},
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: query.limit + 1,
    ...page(query.cursor),
    include: { _count: { select: { members: true, files: true } } },
  });
  const items = rows.slice(0, query.limit);
  const owners = await db.user.findMany({ where: { id: { in: items.map((o) => o.ownerId) } }, select: { id: true, email: true } });
  const ownerEmail = new Map(owners.map((u) => [u.id, u.email]));
  const sums = await db.file.groupBy({ by: ["orgId"], where: { orgId: { in: items.map((o) => o.id) } }, _sum: { size: true } });
  const used = new Map(sums.map((s) => [s.orgId, Number(s._sum?.size ?? 0n)]));
  return {
    items: items.map((o) => ({ id: o.id, name: o.name, slug: o.slug, planKey: o.planKey, ownerEmail: ownerEmail.get(o.ownerId) ?? "", members: o._count.members, files: o._count.files, usedBytes: used.get(o.id) ?? 0, createdAt: o.createdAt.toISOString() })),
    nextCursor: rows.length > query.limit ? items[items.length - 1].id : null,
  };
}

export async function adminGetOrg(id: string) {
  const org = await db.organization.findUnique({ where: { id }, include: { members: { include: { user: { select: { id: true, email: true, displayName: true } } } } } });
  if (!org) throw Errors.notFound("That organization doesn't exist.");
  const usage = await storageUsedBytes({ userId: org.ownerId, orgId: id });
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    planKey: org.planKey,
    createdAt: org.createdAt.toISOString(),
    usedBytes: usage.stored + usage.pending,
    members: org.members.map((m) => ({ userId: m.user.id, name: m.user.displayName, email: m.user.email, role: m.role })),
  };
}

// ---- Shares ----

export const adminShareListSchema = z.object({ status: z.enum(["all", "active", "revoked"]).default("active"), q: z.string().trim().max(100).optional(), cursor: cursorSchema, limit: z.coerce.number().int().min(1).max(100).default(30) });

export async function adminListShares(query: z.infer<typeof adminShareListSchema>) {
  const now = new Date();
  const where: Prisma.ShareLinkWhereInput = {
    ...(query.status === "active" ? { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } : query.status === "revoked" ? { revokedAt: { not: null } } : {}),
    ...(query.q ? { AND: [{ OR: [{ token: query.q }, { id: query.q }, { owner: { email: { contains: query.q.toLowerCase() } } }, { file: { nameKey: { contains: query.q.toLowerCase() } } }] }] } : {}),
  };
  const rows = await db.shareLink.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: query.limit + 1,
    ...page(query.cursor),
    include: { file: { select: { originalName: true } }, folder: { select: { name: true } }, owner: { select: { email: true } } },
  });
  const items = rows.slice(0, query.limit);
  return {
    items: items.map((s) => ({ ...serializeShare(s, s.file?.originalName ?? s.folder?.name), ownerEmail: s.owner.email })),
    nextCursor: rows.length > query.limit ? items[items.length - 1].id : null,
  };
}

export async function adminRevokeShare(adminId: string, id: string, ip?: string) {
  const share = await db.shareLink.findUnique({ where: { id } });
  if (!share) throw Errors.notFound("That link doesn't exist.");
  if (!share.revokedAt) await db.shareLink.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit({ actorType: "admin", actorId: adminId, action: "admin.share_revoked", targetType: "share", targetId: id, ip });
}

// ---- Quarantine / malware review ----

export const quarantineListSchema = z.object({ state: z.enum(["pending", "confirmed", "released", "all"]).default("pending"), cursor: cursorSchema, limit: z.coerce.number().int().min(1).max(100).default(30) });

export async function adminListQuarantine(query: z.infer<typeof quarantineListSchema>) {
  const rows = await db.quarantineItem.findMany({
    where: query.state === "all" ? {} : { state: query.state },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: query.limit + 1,
    ...page(query.cursor),
    include: { file: { select: { id: true, originalName: true, size: true, ownerId: true, mime: true, sha256: true } } },
  });
  const items = rows.slice(0, query.limit);
  const owners = await db.user.findMany({ where: { id: { in: items.map((i) => i.file.ownerId) } }, select: { id: true, email: true } });
  const email = new Map(owners.map((u) => [u.id, u.email]));
  return {
    items: items.map((q) => ({
      id: q.id,
      fileId: q.fileId,
      fileName: q.file.originalName,
      size: Number(q.file.size),
      mime: q.file.mime,
      sha256: q.file.sha256,
      ownerEmail: email.get(q.file.ownerId) ?? "",
      reason: q.reason,
      source: q.source,
      signature: q.signature,
      state: q.state,
      note: q.note,
      createdAt: q.createdAt.toISOString(),
      reviewedAt: q.reviewedAt?.toISOString() ?? null,
    })),
    nextCursor: rows.length > query.limit ? items[items.length - 1].id : null,
  };
}

export const quarantineActionSchema = z.object({ action: z.enum(["release", "confirm", "delete"]), note: z.string().trim().max(300).optional() });

export async function adminQuarantineAction(adminId: string, fileId: string, input: z.infer<typeof quarantineActionSchema>, ip?: string) {
  const file = await db.file.findUnique({ where: { id: fileId } });
  const item = await db.quarantineItem.findUnique({ where: { fileId } });
  if (!file || !item) throw Errors.notFound("That file isn't in quarantine.");
  if (input.action === "release") {
    if (item.state === "confirmed") throw Errors.conflict("This file was confirmed as malicious. Delete it instead of releasing it.");
    await releaseFile(fileId, adminId, input.note);
    await audit({ actorType: "admin", actorId: adminId, action: "admin.file_released", targetType: "file", targetId: fileId, ip });
  } else if (input.action === "confirm") {
    await confirmMalicious(fileId, adminId, input.note);
  } else {
    await destroyFiles([file]);
    await audit({ actorType: "admin", actorId: adminId, action: "admin.file_deleted", targetType: "file", targetId: fileId, ip, metadata: { name: file.originalName, quarantine: true } });
  }
}

// ---- Jobs ----

export const jobListSchema = z.object({ status: z.enum(["queued", "running", "done", "failed", "all"]).default("all"), type: z.string().max(40).optional(), cursor: cursorSchema, limit: z.coerce.number().int().min(1).max(100).default(40) });

export async function adminListJobs(query: z.infer<typeof jobListSchema>) {
  const rows = await db.job.findMany({
    where: { ...(query.status !== "all" ? { status: query.status } : {}), ...(query.type ? { type: query.type } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: query.limit + 1,
    ...page(query.cursor),
  });
  const items = rows.slice(0, query.limit);
  const counts = await db.job.groupBy({ by: ["status"], _count: true });
  const oldest = await db.job.findFirst({ where: { status: "queued" }, orderBy: { runAt: "asc" }, select: { runAt: true } });
  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    oldestQueuedAt: oldest?.runAt.toISOString() ?? null,
    items: items.map((j) => ({ id: j.id, type: j.type, status: j.status, attempts: j.attempts, maxAttempts: j.maxAttempts, lastError: j.lastError, runAt: j.runAt.toISOString(), createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt?.toISOString() ?? null })),
    nextCursor: rows.length > query.limit ? items[items.length - 1].id : null,
  };
}

export async function adminRetryJob(id: string) {
  const { count } = await db.job.updateMany({ where: { id, status: "failed" }, data: { status: "queued", attempts: 0, runAt: new Date(), lastError: null, finishedAt: null } });
  if (!count) throw Errors.conflict("Only failed jobs can be retried.");
  wakeWorker();
}

// ---- API overview ----

export async function adminApiOverview() {
  const now = Date.now();
  const [total24h, errors24h, total7d, topUsers, keys, endpoints] = await Promise.all([
    db.apiUsage.count({ where: { createdAt: { gte: new Date(now - 86400_000) } } }),
    db.apiUsage.count({ where: { createdAt: { gte: new Date(now - 86400_000) }, status: { gte: 500 } } }),
    db.apiUsage.count({ where: { createdAt: { gte: new Date(now - 7 * 86400_000) } } }),
    db.apiUsage.groupBy({ by: ["userId"], where: { createdAt: { gte: new Date(now - 7 * 86400_000) } }, _count: true, orderBy: { _count: { userId: "desc" } }, take: 10 }),
    db.apiKey.count({ where: { revokedAt: null } }),
    db.apiUsage.groupBy({ by: ["endpoint", "method"], where: { createdAt: { gte: new Date(now - 7 * 86400_000) } }, _count: true, _avg: { latencyMs: true }, orderBy: { _count: { endpoint: "desc" } }, take: 15 }),
  ]);
  const users = await db.user.findMany({ where: { id: { in: topUsers.map((t) => t.userId) } }, select: { id: true, email: true } });
  const email = new Map(users.map((u) => [u.id, u.email]));
  return {
    requests24h: total24h,
    serverErrors24h: errors24h,
    requests7d: total7d,
    activeKeys: keys,
    topUsers: topUsers.map((t) => ({ userId: t.userId, email: email.get(t.userId) ?? "", requests: t._count })),
    endpoints: endpoints.map((e) => ({ endpoint: e.endpoint, method: e.method, requests: e._count, avgLatencyMs: Math.round(e._avg?.latencyMs ?? 0) })),
  };
}

// ---- Plans ----

export const planPatchSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(200).optional(),
  priceMonthlyCents: z.number().int().min(0).max(10_000_000).optional(),
  priceYearlyCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().trim().toLowerCase().length(3).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  limits: z.record(z.string(), z.number().int().min(-1)).optional(),
  isPublic: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  stripe: z.object({ month: z.string().max(80).optional(), year: z.string().max(80).optional() }).optional(),
});

export const planCreateSchema = planPatchSchema.extend({ key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,29}$/, "Use 2–30 lowercase letters, digits, - or _."), name: z.string().trim().min(1).max(40) });

function cleanFeatures(input: Record<string, boolean>, base: PlanFeatures): PlanFeatures {
  const out = { ...base };
  for (const k of Object.keys(input)) {
    if (!(FEATURE_KEYS as string[]).includes(k)) throw Errors.validation(`Unknown feature "${k}".`);
    out[k as keyof PlanFeatures] = input[k];
  }
  return out;
}

function cleanLimits(input: Record<string, number>, base: PlanLimits): PlanLimits {
  const out = { ...base };
  for (const k of Object.keys(input)) {
    if (!(LIMIT_KEYS as string[]).includes(k)) throw Errors.validation(`Unknown limit "${k}".`);
    out[k as keyof PlanLimits] = input[k];
  }
  return out;
}

export async function adminListPlans() {
  const plans = await listPlans();
  const counts = await db.user.groupBy({ by: ["planKey"], _count: true });
  const orgCounts = await db.organization.groupBy({ by: ["planKey"], _count: true });
  const users = new Map(counts.map((c) => [c.planKey, c._count]));
  const orgs = new Map(orgCounts.map((c) => [c.planKey, c._count]));
  return plans.map((p) => ({ ...p, users: users.get(p.key) ?? 0, organizations: orgs.get(p.key) ?? 0 }));
}

export async function adminUpdatePlan(adminId: string, key: string, patch: z.infer<typeof planPatchSchema>, ip?: string) {
  const existing = await getPlan(key);
  if (existing.key !== key) throw Errors.notFound("That plan doesn't exist.");
  if (patch.isDefault === false && existing.isDefault) throw Errors.conflict("Choose another default plan instead of unsetting this one.");
  const prices = { ...existing.providerPrices, ...(patch.stripe ? { stripe: { ...existing.providerPrices.stripe, ...patch.stripe } } : {}) };
  await db.$transaction(async (tx) => {
    if (patch.isDefault) await tx.plan.updateMany({ where: { key: { not: key } }, data: { isDefault: false } });
    await tx.plan.update({
      where: { key },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.priceMonthlyCents !== undefined ? { priceMonthlyCents: patch.priceMonthlyCents } : {}),
        ...(patch.priceYearlyCents !== undefined ? { priceYearlyCents: patch.priceYearlyCents } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.features ? { features: JSON.stringify(cleanFeatures(patch.features, existing.features)) } : {}),
        ...(patch.limits ? { limits: JSON.stringify(cleanLimits(patch.limits, existing.limits)) } : {}),
        ...(patch.isPublic !== undefined ? { isPublic: patch.isPublic } : {}),
        ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        providerPrices: JSON.stringify(prices),
      },
    });
  });
  invalidatePlanCache();
  await audit({ actorType: "admin", actorId: adminId, action: "admin.plan_updated", targetType: "plan", targetId: key, ip, metadata: { fields: Object.keys(patch) } });
  return getPlan(key);
}

export async function adminCreatePlan(adminId: string, input: z.infer<typeof planCreateSchema>, ip?: string) {
  if ((await listPlans()).some((p) => p.key === input.key)) throw Errors.conflict("A plan with that key already exists.");
  const base = (await listPlans()).find((p) => p.isDefault) ?? (await listPlans())[0];
  await db.plan.create({
    data: {
      key: input.key,
      name: input.name,
      description: input.description ?? "",
      priceMonthlyCents: input.priceMonthlyCents ?? 0,
      priceYearlyCents: input.priceYearlyCents ?? 0,
      currency: input.currency ?? "usd",
      features: JSON.stringify(cleanFeatures(input.features ?? {}, base.features)),
      limits: JSON.stringify(cleanLimits(input.limits ?? {}, base.limits)),
      isPublic: input.isPublic ?? false,
      isDefault: false,
      sortOrder: input.sortOrder ?? 100,
      providerPrices: JSON.stringify(input.stripe ? { stripe: input.stripe } : {}),
    },
  });
  invalidatePlanCache();
  await audit({ actorType: "admin", actorId: adminId, action: "admin.plan_updated", targetType: "plan", targetId: input.key, ip, metadata: { created: true } });
  return getPlan(input.key);
}

// ---- Subscriptions ----

export const subscriptionListSchema = z.object({ status: z.enum(["all", "active", "trialing", "past_due", "canceled"]).default("all"), cursor: cursorSchema, limit: z.coerce.number().int().min(1).max(100).default(30) });

export async function adminListSubscriptions(query: z.infer<typeof subscriptionListSchema>) {
  const rows = await db.subscription.findMany({
    where: query.status === "all" ? {} : { status: query.status },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: query.limit + 1,
    ...page(query.cursor),
    include: { user: { select: { email: true } }, org: { select: { name: true } } },
  });
  const items = rows.slice(0, query.limit);
  return {
    items: items.map((s) => ({ id: s.id, subject: s.org ? { type: "org", label: s.org.name, id: s.orgId } : { type: "user", label: s.user?.email ?? "", id: s.userId }, planKey: s.planKey, status: s.status, interval: s.interval, provider: s.provider, currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null, cancelAtPeriodEnd: s.cancelAtPeriodEnd, createdAt: s.createdAt.toISOString() })),
    nextCursor: rows.length > query.limit ? items[items.length - 1].id : null,
  };
}

export const assignPlanSchema = z.object({
  subjectType: z.enum(["user", "org"]),
  subjectId: z.string().max(40),
  planKey: z.string().max(40),
  interval: z.enum(["month", "year"]).default("month"),
  periodEnd: z.string().datetime({ offset: true }).transform((s) => new Date(s)).nullable().optional(),
});

/** Administrator-assigned plan (the only way to change plans while no payment provider is configured). */
export async function adminAssignPlan(adminId: string, input: z.infer<typeof assignPlanSchema>, ip?: string) {
  const subject: Subject = { type: input.subjectType, id: input.subjectId };
  await assignPlan(subject, input.planKey, { interval: input.interval, by: { type: "admin", id: adminId }, periodEnd: input.periodEnd ?? null, provider: "internal" });
  await audit({ actorType: "admin", actorId: adminId, action: "admin.plan_changed", targetType: subject.type, targetId: subject.id, ip, metadata: { planKey: input.planKey } });
}

// ---- Webhooks overview ----

export async function adminListWebhooks() {
  const rows = await db.webhook.findMany({ orderBy: [{ failureCount: "desc" }, { createdAt: "desc" }], take: 200, include: { owner: { select: { email: true } } } });
  return rows.map((w) => ({ id: w.id, name: w.name, host: (() => { try { return new URL(w.url).host; } catch { return ""; } })(), ownerEmail: w.owner.email, orgId: w.orgId, enabled: w.enabled, failureCount: w.failureCount, lastDeliveryAt: w.lastDeliveryAt?.toISOString() ?? null, createdAt: w.createdAt.toISOString() }));
}

export async function adminSetWebhookEnabled(adminId: string, id: string, enabled: boolean) {
  const { count } = await db.webhook.updateMany({ where: { id }, data: { enabled, ...(enabled ? { failureCount: 0 } : {}) } });
  if (!count) throw Errors.notFound("That webhook doesn't exist.");
  await audit({ actorType: "admin", actorId: adminId, action: "webhook.updated", targetType: "webhook", targetId: id, metadata: { enabled, byAdmin: true } });
}

// ---- Backups, email outbox, flags ----

export async function adminListBackups() {
  const rows = await db.backupRecord.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  return rows.map((b) => ({ id: b.id, status: b.status, size: b.size == null ? null : Number(b.size), error: b.error, createdAt: b.createdAt.toISOString(), finishedAt: b.finishedAt?.toISOString() ?? null, file: b.path ? b.path.split(/[\\/]/).pop() : null }));
}

export async function adminCreateBackup(adminId: string) {
  const result = await backupDatabase({ force: true });
  await audit({ actorType: "admin", actorId: adminId, action: "admin.backup_created", metadata: { size: result?.size } });
  return result;
}

export async function adminEmailOutbox() {
  const rows = await db.emailMessage.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((e) => ({ id: e.id, to: e.toEmail, template: e.template, subject: e.subject, status: e.status, provider: e.provider, error: e.error, createdAt: e.createdAt.toISOString() }));
}

export async function adminFlags() {
  return allFlags();
}

export async function adminSetFlag(adminId: string, key: string, enabled: boolean, ip?: string) {
  if (!(FLAG_KEYS as string[]).includes(key)) throw Errors.notFound("That flag doesn't exist.");
  await setFlag(key as FlagKey, enabled);
  await audit({ actorType: "admin", actorId: adminId, action: "admin.flag_changed", targetType: "flag", targetId: key, ip, metadata: { enabled } });
}

// ---- Health ----

export async function adminHealth() {
  const { runStatusChecks } = await import("./ops");
  const { emailStatus } = await import("./email");
  const { getSettings } = await import("../settings");
  const { stripeConfigured } = await import("./billing");
  const { env } = await import("../env");
  const settings = await getSettings();
  const checks = await runStatusChecks();
  const lastBackup = await db.backupRecord.findFirst({ where: { status: "ok" }, orderBy: { createdAt: "desc" } });
  return {
    checks,
    email: emailStatus(),
    billing: { provider: settings.billing.provider, stripeConfigured: stripeConfigured() },
    scanner: settings.scanner.provider,
    maintenance: settings.maintenance.enabled,
    workerEnabled: env.workerEnabled,
    lastBackupAt: lastBackup?.createdAt.toISOString() ?? null,
    backupsEnabled: settings.backups.enabled,
  };
}
