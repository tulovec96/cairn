import fsp from "node:fs/promises";
import path from "node:path";
import { isUnlimited } from "@/config/entitlements";
import { db } from "../db";
import { env } from "../env";
import { storage } from "../storage";
import { thumbKeysOf } from "../storage/keys";
import { audit } from "./audit";
import { destroyFiles } from "./files";
import { entitlementsForScope } from "./limits";
import { notify, pruneNotifications } from "./notifications";

const DAY = 86400_000;

/** Deletes files whose expiry has passed, reclaiming their storage, and tells owners once per run. */
export async function expireFiles(limit = 300): Promise<number> {
  const due = await db.file.findMany({ where: { expiresAt: { lte: new Date() } }, take: limit });
  if (!due.length) return 0;
  const perOwner = new Map<string, string[]>();
  for (const f of due) perOwner.set(f.ownerId, [...(perOwner.get(f.ownerId) ?? []), f.originalName]);
  const trashed = due.filter((f) => f.trashBatchId).map((f) => f.trashBatchId!);
  await destroyFiles(due);
  if (trashed.length) await db.trashItem.deleteMany({ where: { id: { in: trashed }, kind: "file" } });
  for (const f of due) {
    await audit({ actorType: "system", action: "file.expired", targetType: "file", targetId: f.id, metadata: { name: f.originalName } });
  }
  for (const [userId, names] of perOwner) {
    await notify({
      userId,
      type: "file_expired",
      title: names.length === 1 ? "A file expired" : `${names.length} files expired`,
      body: names.length === 1 ? `${names[0]} reached its expiry date and was deleted.` : `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""} reached their expiry date and were deleted.`,
      href: "/files",
    });
  }
  return due.length;
}

/** Deletes stored versions that are older than the owner's plan allows (`versionRetentionDays`). */
export async function expireVersions(): Promise<number> {
  const old = await db.fileVersion.findMany({
    where: { createdAt: { lte: new Date(Date.now() - DAY) } },
    select: { id: true, storageKey: true, createdAt: true, file: { select: { ownerId: true, orgId: true } } },
    take: 2000,
  });
  const retention = new Map<string, number>();
  let removed = 0;
  for (const v of old) {
    const key = `${v.file.ownerId}:${v.file.orgId ?? ""}`;
    if (!retention.has(key)) retention.set(key, (await entitlementsForScope({ userId: v.file.ownerId, orgId: v.file.orgId })).limits.versionRetentionDays);
    const days = retention.get(key)!;
    if (isUnlimited(days) || v.createdAt.getTime() > Date.now() - days * DAY) continue;
    await storage().delete(v.storageKey).catch(() => undefined);
    await db.fileVersion.delete({ where: { id: v.id } }).catch(() => undefined);
    removed++;
  }
  return removed;
}

export async function cleanupUploads(): Promise<void> {
  const now = new Date();
  const stale = await db.upload.findMany({ where: { status: "active", sessionExpiresAt: { lte: now } }, take: 200 });
  for (const u of stale) {
    await fsp.unlink(u.stagingPath).catch(() => undefined);
    await db.upload.update({ where: { id: u.id }, data: { status: "expired" } });
    await db.uploadChunk.deleteMany({ where: { uploadId: u.id } });
  }
  await db.upload.deleteMany({ where: { status: { in: ["complete", "aborted", "expired", "failed"] }, updatedAt: { lte: new Date(Date.now() - 7 * DAY) } } });

  // Staging files that no longer belong to an active upload (e.g. after a crash).
  const dir = path.join(env.tmpDir, "uploads");
  const entries = await fsp.readdir(dir).catch(() => [] as string[]);
  for (const name of entries) {
    if (!name.endsWith(".part")) continue;
    const full = path.join(dir, name);
    const st = await fsp.stat(full).catch(() => null);
    if (!st || Date.now() - st.mtimeMs < DAY) continue;
    const id = name.slice(0, -5);
    const upload = await db.upload.findUnique({ where: { id }, select: { status: true } });
    if (!upload || !["active", "finalizing"].includes(upload.status)) await fsp.unlink(full).catch(() => undefined);
  }
}

export async function cleanupArchives(): Promise<void> {
  const expired = await db.archiveJob.findMany({ where: { expiresAt: { lte: new Date() }, status: { not: "expired" } }, take: 200 });
  for (const a of expired) {
    if (a.storageKey) await storage().delete(a.storageKey).catch(() => undefined);
    await db.archiveJob.update({ where: { id: a.id }, data: { status: "expired", storageKey: null } });
  }
  await db.archiveJob.deleteMany({ where: { status: "expired", expiresAt: { lte: new Date(Date.now() - 7 * DAY) } } });
  // Jobs stuck in "running" from a crashed process are failed so they don't spin forever in the UI.
  await db.archiveJob.updateMany({ where: { status: "running", updatedAt: { lte: new Date(Date.now() - 3600_000) } }, data: { status: "failed", error: "The archive was interrupted." } });
  const dir = path.join(env.tmpDir, "archives");
  for (const name of await fsp.readdir(dir).catch(() => [] as string[])) {
    const full = path.join(dir, name);
    const st = await fsp.stat(full).catch(() => null);
    if (st && Date.now() - st.mtimeMs > DAY) await fsp.unlink(full).catch(() => undefined);
  }
  // Expired account exports.
  const exports = await db.dataExport.findMany({ where: { expiresAt: { lte: new Date() }, status: { in: ["ready", "failed", "queued"] } }, take: 100 });
  for (const e of exports) {
    if (e.storageKey) await storage().delete(e.storageKey).catch(() => undefined);
    await db.dataExport.update({ where: { id: e.id }, data: { status: "expired", storageKey: null } });
  }
}

export async function cleanupSessions(): Promise<void> {
  const now = new Date();
  await db.session.deleteMany({ where: { expiresAt: { lte: now } } });
  await db.authToken.deleteMany({ where: { expiresAt: { lte: new Date(Date.now() - DAY) } } });
}

/** Removes blobs that no database row refers to (older than a day, to avoid racing in-flight uploads). */
export async function storageGc(): Promise<number> {
  let removed = 0;
  let batch: string[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const thumbBases = [...new Set(batch.filter((k) => /\.(s|m|l)$/.test(k)).map((k) => k.slice(0, -2)))];
    const [files, thumbs, versions, archives, exports, requests] = await Promise.all([
      db.file.findMany({ where: { storageKey: { in: batch } }, select: { storageKey: true } }),
      thumbBases.length ? db.file.findMany({ where: { thumbnailKey: { in: thumbBases } }, select: { thumbnailKey: true } }) : Promise.resolve([]),
      db.fileVersion.findMany({ where: { storageKey: { in: batch } }, select: { storageKey: true } }),
      db.archiveJob.findMany({ where: { storageKey: { in: batch } }, select: { storageKey: true } }),
      db.dataExport.findMany({ where: { storageKey: { in: batch } }, select: { storageKey: true } }),
      db.fileRequest.findMany({ where: { logoKey: { in: batch } }, select: { logoKey: true } }),
    ]);
    const known = new Set<string>([
      ...files.map((f) => f.storageKey),
      ...thumbs.flatMap((f) => thumbKeysOf(f.thumbnailKey)),
      ...versions.map((v) => v.storageKey),
      ...archives.map((a) => a.storageKey!),
      ...exports.map((e) => e.storageKey!),
      ...requests.map((r) => r.logoKey!),
    ]);
    for (const key of batch) {
      if (!known.has(key)) {
        await storage().delete(key).catch(() => undefined);
        removed++;
      }
    }
    batch = [];
  };
  for await (const blob of storage().walk()) {
    if (Date.now() - blob.mtimeMs < DAY) continue;
    batch.push(blob.key);
    if (batch.length >= 200) await flush();
  }
  await flush();
  return removed;
}

export async function statsSnapshot(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - DAY);
  const [users, files, storageSum, downloads, uploads] = await Promise.all([
    db.user.count(),
    db.file.count({ where: { deletedAt: null } }),
    db.file.aggregate({ _sum: { size: true } }),
    db.download.count({ where: { createdAt: { gte: since } } }),
    db.file.count({ where: { createdAt: { gte: since } } }),
  ]);
  const data = { users, files, storageBytes: storageSum._sum?.size ?? 0n, downloads, uploads };
  await db.statSnapshot.upsert({ where: { day }, create: { day, ...data }, update: data });
}

/** Tells owners a day before their share links stop working. One notice per link. */
export async function shareExpiryNotices(): Promise<void> {
  const soon = await db.shareLink.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date(), lte: new Date(Date.now() + DAY) } },
    include: { file: { select: { originalName: true } }, folder: { select: { name: true } } },
    take: 500,
  });
  for (const s of soon) {
    const name = s.file?.originalName ?? s.folder?.name ?? "a link";
    await notify({ userId: s.ownerId, type: "share_expiring", title: "A share link expires within a day", body: `The link to ${name} will stop working ${s.expiresAt!.toISOString().slice(0, 16).replace("T", " ")} UTC.`, href: "/shares", dedupeKey: `share_exp:${s.id}`, dedupeHours: 72 });
  }
}

export async function jobGc(): Promise<void> {
  await db.job.deleteMany({ where: { status: "done", finishedAt: { lte: new Date(Date.now() - 2 * DAY) } } });
  await db.job.deleteMany({ where: { status: "failed", finishedAt: { lte: new Date(Date.now() - 14 * DAY) } } });
  await db.download.deleteMany({ where: { createdAt: { lte: new Date(Date.now() - 400 * DAY) } } });
  await db.auditLog.deleteMany({ where: { createdAt: { lte: new Date(Date.now() - 400 * DAY) } } });
  await db.apiUsage.deleteMany({ where: { createdAt: { lte: new Date(Date.now() - 90 * DAY) } } });
  await db.shareEvent.deleteMany({ where: { createdAt: { lte: new Date(Date.now() - 400 * DAY) } } });
  await db.statusCheck.deleteMany({ where: { createdAt: { lte: new Date(Date.now() - 45 * DAY) } } });
  await db.webhookDelivery.deleteMany({ where: { createdAt: { lte: new Date(Date.now() - 30 * DAY) } } });
  await db.automationRun.deleteMany({ where: { createdAt: { lte: new Date(Date.now() - 30 * DAY) } } });
  await db.emailMessage.deleteMany({ where: { createdAt: { lte: new Date(Date.now() - 60 * DAY) } } });
  await pruneNotifications();
}
