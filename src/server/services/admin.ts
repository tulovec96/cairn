import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { Errors } from "../errors";
import { wakeWorker } from "../jobs/queue";
import { storage } from "../storage";
import type { Actor as UserActor } from "./actor";
import { audit } from "./audit";
import { purgeUserData } from "./auth";
import { destroyFiles } from "./files";
import { entitlementsForUser } from "./entitlements";
import { usageForScope } from "./limits";
import { quarantineFile, releaseFile, requestRescan } from "./scanning";
import { serializeFile, serializeUser } from "./serializers";

const DAY = 86400_000;

export async function adminOverview() {
  const now = new Date();
  const [users, suspended, organizations, files, storageSum, downloadsTotal, downloads24h, activeShares, pendingReports, expiringSoon, failedUploads, quarantined, jobsQueued, jobsFailed, snapshots] =
    await Promise.all([
      db.user.count(),
      db.user.count({ where: { status: "suspended" } }),
      db.organization.count(),
      db.file.count({ where: { deletedAt: null } }),
      db.file.aggregate({ _sum: { size: true } }),
      db.file.aggregate({ _sum: { downloadCount: true } }),
      db.download.count({ where: { createdAt: { gte: new Date(Date.now() - DAY) } } }),
      db.shareLink.count({ where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      db.abuseReport.count({ where: { status: { in: ["open", "reviewing"] } } }),
      db.file.count({ where: { expiresAt: { gt: now, lte: new Date(Date.now() + DAY) } } }),
      db.upload.count({ where: { status: "failed", updatedAt: { gte: new Date(Date.now() - 7 * DAY) } } }),
      db.file.count({ where: { status: "quarantined" } }),
      db.job.count({ where: { status: { in: ["queued", "running"] } } }),
      db.job.count({ where: { status: "failed" } }),
      db.statSnapshot.findMany({ orderBy: { day: "desc" }, take: 14 }),
    ]);
  const health = await storage().health();
  return {
    users,
    suspendedUsers: suspended,
    organizations,
    files,
    storageBytes: Number(storageSum._sum.size ?? 0n),
    downloadsTotal: downloadsTotal._sum.downloadCount ?? 0,
    downloads24h,
    activeShares,
    pendingReports,
    expiringSoon,
    failedUploads,
    quarantined,
    jobs: { pending: jobsQueued, failed: jobsFailed },
    storage: health,
    snapshots: snapshots
      .map((s) => ({ day: s.day, users: s.users, files: s.files, storageBytes: Number(s.storageBytes), downloads: s.downloads, uploads: s.uploads }))
      .reverse(),
  };
}

export const listUsersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function listUsers(query: z.infer<typeof listUsersSchema>) {
  const where: Prisma.UserWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { OR: [{ email: { contains: query.q.toLowerCase() } }, { displayName: { contains: query.q } }, { id: query.q }] } : {}),
  };
  const rows = await db.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: { _count: { select: { files: true } } },
  });
  const page = rows.slice(0, query.limit);
  const sums = await db.file.groupBy({ by: ["ownerId"], where: { ownerId: { in: page.map((u) => u.id) } }, _sum: { size: true } });
  const usage = new Map(sums.map((s) => [s.ownerId, Number(s._sum?.size ?? 0n)]));
  return {
    items: page.map((u) => ({ ...serializeUser(u), fileCount: u._count.files, usedBytes: usage.get(u.id) ?? 0 })),
    nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
  };
}

export async function getUserDetail(id: string) {
  const user = await db.user.findUnique({ where: { id }, include: { _count: { select: { files: true, folders: true, apiKeys: true, sessions: true, shares: true } } } });
  if (!user) throw Errors.notFound("That user doesn't exist.");
  const ent = await entitlementsForUser(user);
  const limits = { plan: ent.planKey, storageBytes: ent.limits.storageBytes, maxFileBytes: ent.limits.maxFileBytes };
  const usage = await usageForScope({ userId: id, orgId: null }, ent);
  const recentFiles = await db.file.findMany({ where: { ownerId: id }, orderBy: { createdAt: "desc" }, take: 15 });
  const recentAudit = await db.auditLog.findMany({ where: { OR: [{ actorId: id }, { targetId: id }] }, orderBy: { createdAt: "desc" }, take: 15 });
  return {
    user: serializeUser(user),
    counts: user._count,
    limits,
    overrides: { quotaBytes: user.quotaBytes == null ? null : Number(user.quotaBytes), maxFileBytes: user.maxFileBytes == null ? null : Number(user.maxFileBytes) },
    suspendedReason: user.suspendedReason,
    usage,
    recentFiles: recentFiles.map((f) => serializeFile(f)),
    audit: recentAudit.map((a) => ({ id: a.id, action: a.action, createdAt: a.createdAt.toISOString(), ip: a.ip, actorId: a.actorId, targetId: a.targetId })),
  };
}

export const updateUserSchema = z.object({
  status: z.enum(["active", "suspended"]).optional(),
  suspendedReason: z.string().trim().max(300).nullable().optional(),
  role: z.enum(["user", "admin"]).optional(),
  quotaBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  maxFileBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
});

async function assertNotLastAdmin(userId: string) {
  const target = await db.user.findUnique({ where: { id: userId } });
  if (target?.role === "admin" && target.status === "active") {
    const admins = await db.user.count({ where: { role: "admin", status: "active" } });
    if (admins <= 1) throw Errors.conflict("This is the only active administrator.");
  }
}

export async function updateUser(admin: UserActor, id: string, patch: z.infer<typeof updateUserSchema>, ip?: string) {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw Errors.notFound("That user doesn't exist.");
  if (id === admin.user.id && (patch.status === "suspended" || patch.role === "user")) throw Errors.conflict("You can't suspend or demote your own account.");
  if ((patch.status === "suspended" || patch.role === "user") && user.role === "admin") await assertNotLastAdmin(id);

  const data: Prisma.UserUpdateInput = {};
  if (patch.status) {
    data.status = patch.status;
    data.suspendedReason = patch.status === "suspended" ? (patch.suspendedReason ?? null) : null;
  }
  if (patch.role) data.role = patch.role;
  if (patch.quotaBytes !== undefined) data.quotaBytes = patch.quotaBytes === null ? null : BigInt(patch.quotaBytes);
  if (patch.maxFileBytes !== undefined) data.maxFileBytes = patch.maxFileBytes === null ? null : BigInt(patch.maxFileBytes);
  const updated = await db.user.update({ where: { id }, data });
  if (patch.status === "suspended") {
    await db.session.deleteMany({ where: { userId: id } });
    await audit({ actorType: "admin", actorId: admin.user.id, action: "admin.user_suspended", targetType: "user", targetId: id, ip, metadata: { reason: patch.suspendedReason } });
  } else if (patch.status === "active" && user.status === "suspended") {
    await audit({ actorType: "admin", actorId: admin.user.id, action: "admin.user_restored", targetType: "user", targetId: id, ip });
  }
  if (patch.role && patch.role !== user.role) await audit({ actorType: "admin", actorId: admin.user.id, action: "admin.role_changed", targetType: "user", targetId: id, ip, metadata: { role: patch.role } });
  if (patch.quotaBytes !== undefined || patch.maxFileBytes !== undefined) {
    await audit({ actorType: "admin", actorId: admin.user.id, action: "admin.user_limits_changed", targetType: "user", targetId: id, ip, metadata: { quotaBytes: patch.quotaBytes, maxFileBytes: patch.maxFileBytes } });
  }
  return serializeUser(updated);
}

export async function revokeUserSessions(admin: UserActor, id: string, ip?: string) {
  const { count } = await db.session.deleteMany({ where: { userId: id } });
  await audit({ actorType: "admin", actorId: admin.user.id, action: "admin.user_sessions_revoked", targetType: "user", targetId: id, ip, metadata: { count } });
  return count;
}

export async function deleteUserAccount(admin: UserActor, id: string, ip?: string) {
  if (id === admin.user.id) throw Errors.conflict("You can't delete your own account from the admin panel. Use account settings instead.");
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw Errors.notFound("That user doesn't exist.");
  if (user.role === "admin") await assertNotLastAdmin(id);
  const result = await purgeUserData(id);
  await audit({ actorType: "admin", actorId: admin.user.id, action: "admin.user_deleted", targetType: "user", targetId: id, ip, metadata: { email: user.email, ...result } });
}

export const listAdminFilesSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["processing", "scanning", "available", "quarantined", "failed"]).optional(),
  scan: z.enum(["pending", "scanning", "clean", "infected", "error", "not_scanned"]).optional(),
  ownerId: z.string().max(40).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function listAdminFiles(query: z.infer<typeof listAdminFilesSchema>) {
  const q = query.q?.toLowerCase();
  const where: Prisma.FileWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.scan ? { scanStatus: query.scan } : {}),
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(q
      ? { OR: [{ nameKey: { contains: q } }, { sha256: q }, { id: query.q }, { owner: { email: { contains: q } } }] }
      : {}),
  };
  const rows = await db.file.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: { owner: { select: { id: true, displayName: true, email: true } } },
  });
  const page = rows.slice(0, query.limit);
  return {
    items: page.map((f) => ({ ...serializeFile(f, { includeOwner: true }), ownerEmail: f.owner?.email ?? null })),
    nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
  };
}

export async function getAdminFile(id: string) {
  const file = await db.file.findUnique({
    where: { id },
    include: { owner: { select: { id: true, displayName: true, email: true } }, scans: { orderBy: { startedAt: "desc" }, take: 10 }, reports: { orderBy: { createdAt: "desc" }, take: 10 }, shares: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  if (!file) throw Errors.notFound("That file doesn't exist.");
  return {
    file: { ...serializeFile(file, { includeOwner: true }), ownerEmail: file.owner?.email ?? null },
    storageKey: file.storageKey,
    scans: file.scans.map((s) => ({ id: s.id, provider: s.provider, status: s.status, signature: s.signature, details: s.details, startedAt: s.startedAt.toISOString(), finishedAt: s.finishedAt?.toISOString() ?? null })),
    reports: file.reports.map((r) => ({ id: r.id, category: r.category, status: r.status, createdAt: r.createdAt.toISOString() })),
    shareCount: file.shares.length,
  };
}

export const adminFileActionSchema = z.object({ action: z.enum(["quarantine", "release", "delete", "rescan"]), note: z.string().trim().max(300).optional() });

export async function adminFileAction(admin: UserActor, id: string, input: z.infer<typeof adminFileActionSchema>, ip?: string) {
  const file = await db.file.findUnique({ where: { id } });
  if (!file) throw Errors.notFound("That file doesn't exist.");
  switch (input.action) {
    case "quarantine":
      await quarantineFile(id, input.note || "Blocked by an administrator", { source: "admin" });
      await audit({ actorType: "admin", actorId: admin.user.id, action: "admin.file_quarantined", targetType: "file", targetId: id, ip, metadata: { note: input.note } });
      break;
    case "release":
      await releaseFile(id, admin.user.id, input.note);
      await audit({ actorType: "admin", actorId: admin.user.id, action: "admin.file_released", targetType: "file", targetId: id, ip });
      break;
    case "delete":
      await destroyFiles([file]);
      await audit({ actorType: "admin", actorId: admin.user.id, action: "admin.file_deleted", targetType: "file", targetId: id, ip, metadata: { name: file.originalName } });
      return { deleted: true };
    case "rescan": {
      const queued = await requestRescan(id);
      if (!queued) throw Errors.conflict("No scanner is configured. Enable one in System settings first.");
      break;
    }
  }
  return { deleted: false };
}

export const listReportsSchema = z.object({
  status: z.enum(["open", "reviewing", "actioned", "dismissed", "pending"]).default("pending"),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function listReports(query: z.infer<typeof listReportsSchema>) {
  const where: Prisma.AbuseReportWhereInput = query.status === "pending" ? { status: { in: ["open", "reviewing"] } } : { status: query.status };
  const rows = await db.abuseReport.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: { file: { select: { id: true, originalName: true, status: true, size: true, ownerId: true } } },
  });
  const page = rows.slice(0, query.limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      category: r.category,
      description: r.description,
      contact: r.contact,
      status: r.status,
      resolutionNote: r.resolutionNote,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      fileId: r.file?.id ?? null,
      fileName: r.file?.originalName ?? r.fileName,
      fileStatus: r.file?.status ?? "deleted",
      fileSize: r.file ? Number(r.file.size) : null,
      fileOwnerId: r.file?.ownerId ?? r.fileOwnerId,
    })),
    nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
  };
}

export const listAuditSchema = z.object({
  action: z.string().trim().max(60).optional(),
  actorId: z.string().trim().max(40).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listAudit(query: z.infer<typeof listAuditSchema>) {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.action ? { action: { startsWith: query.action } } : {}),
    ...(query.actorId ? { OR: [{ actorId: query.actorId }, { targetId: query.actorId }] } : {}),
  };
  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  return {
    items: page.map((a) => ({
      id: a.id,
      actorType: a.actorType,
      actorId: a.actorId,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      ip: a.ip,
      metadata: a.metadata ? (JSON.parse(a.metadata) as Record<string, unknown>) : null,
      createdAt: a.createdAt.toISOString(),
    })),
    nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
  };
}

export async function storageOverview() {
  const [byCategory, topUsers, health, snapshots, failedJobs] = await Promise.all([
    db.file.groupBy({ by: ["category"], _sum: { size: true }, _count: true }),
    db.file.groupBy({ by: ["ownerId"], _sum: { size: true }, _count: true, orderBy: { _sum: { size: "desc" } }, take: 10 }),
    storage().health(),
    db.statSnapshot.findMany({ orderBy: { day: "desc" }, take: 30 }),
    db.job.findMany({ where: { status: "failed" }, orderBy: { finishedAt: "desc" }, take: 10 }),
  ]);
  const users = await db.user.findMany({ where: { id: { in: topUsers.map((t) => t.ownerId!) } }, select: { id: true, email: true, displayName: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    health,
    byCategory: byCategory.map((c) => ({ category: c.category, files: c._count, bytes: Number(c._sum.size ?? 0n) })).sort((a, b) => b.bytes - a.bytes),
    topUsers: topUsers.map((t) => ({ userId: t.ownerId!, email: byId.get(t.ownerId!)?.email ?? "(deleted)", name: byId.get(t.ownerId!)?.displayName ?? "", files: t._count, bytes: Number(t._sum.size ?? 0n) })),
    snapshots: snapshots.map((s) => ({ day: s.day, users: s.users, files: s.files, storageBytes: Number(s.storageBytes), downloads: s.downloads, uploads: s.uploads })),
    failedJobs: failedJobs.map((j) => ({ id: j.id, type: j.type, attempts: j.attempts, lastError: j.lastError, finishedAt: j.finishedAt?.toISOString() ?? null })),
  };
}

export async function retryFailedJobs(adminId: string) {
  const { count } = await db.job.updateMany({ where: { status: "failed" }, data: { status: "queued", attempts: 0, runAt: new Date(), lastError: null, finishedAt: null } });
  wakeWorker();
  void adminId;
  return count;
}
