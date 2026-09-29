import { db } from "../db";
import { scopeOf, scopeWhere, type Actor } from "./actor";
import { assertFeature } from "./entitlements";
import { entitlementsForActor, storageUsedBytes } from "./limits";
import { findDuplicates } from "./library";
import { subjectOf, usageHistory, getUsage } from "./usage";

const DAY = 86400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function lastDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => isoDay(new Date(Date.now() - (n - 1 - i) * DAY)));
}

/** Storage breakdown for the current workspace. Everything is computed from the files that exist right now. */
export async function storageAnalytics(actor: Actor) {
  const scope = scopeOf(actor);
  const where = { ...scopeWhere(scope), deletedAt: null };
  const ent = await entitlementsForActor(actor);
  const [used, byCategory, largest, stale, trash, versions] = await Promise.all([
    storageUsedBytes(scope),
    db.file.groupBy({ by: ["category"], where, _sum: { size: true }, _count: true }),
    db.file.findMany({ where, orderBy: { size: "desc" }, take: 10, select: { id: true, originalName: true, size: true, category: true, createdAt: true } }),
    db.file.findMany({ where: { ...where, OR: [{ lastAccessedAt: null }, { lastAccessedAt: { lt: new Date(Date.now() - 180 * DAY) } }], createdAt: { lt: new Date(Date.now() - 90 * DAY) } }, orderBy: { size: "desc" }, take: 10, select: { id: true, originalName: true, size: true, lastAccessedAt: true, createdAt: true } }),
    db.file.aggregate({ where: { ...scopeWhere(scope), deletedAt: { not: null } }, _sum: { size: true }, _count: true }),
    db.fileVersion.aggregate({ where: { file: scopeWhere(scope) }, _sum: { size: true }, _count: true }),
  ]);
  const advanced = ent.features.advancedAnalytics;
  let growth: Array<{ day: string; bytes: number }> = [];
  let duplicates: { reclaimableBytes: number; groups: number } | null = null;
  if (advanced) {
    const rows = await db.file.findMany({ where: { ...where, createdAt: { gte: new Date(Date.now() - 90 * DAY) } }, select: { size: true, createdAt: true }, take: 100_000 });
    const before = await db.file.aggregate({ where: { ...where, createdAt: { lt: new Date(Date.now() - 90 * DAY) } }, _sum: { size: true } });
    const perDay = new Map<string, number>();
    for (const r of rows) perDay.set(isoDay(r.createdAt), (perDay.get(isoDay(r.createdAt)) ?? 0) + Number(r.size));
    let running = Number(before._sum?.size ?? 0n);
    growth = lastDays(90).map((day) => {
      running += perDay.get(day) ?? 0;
      return { day, bytes: running };
    });
    const dupes = await findDuplicates(actor);
    duplicates = { reclaimableBytes: dupes.reclaimableBytes, groups: dupes.groups.length };
  }
  return {
    advanced,
    quotaBytes: ent.limits.storageBytes,
    usedBytes: used.stored + used.pending,
    filesBytes: byCategory.reduce((n, c) => n + Number(c._sum?.size ?? 0n), 0),
    versionsBytes: Number(versions._sum?.size ?? 0n),
    versionCount: versions._count,
    trashBytes: Number(trash._sum?.size ?? 0n),
    trashCount: trash._count,
    byCategory: byCategory.map((c) => ({ category: c.category, files: c._count, bytes: Number(c._sum?.size ?? 0n) })).sort((a, b) => b.bytes - a.bytes),
    largest: largest.map((f) => ({ id: f.id, name: f.originalName, bytes: Number(f.size), category: f.category, createdAt: f.createdAt.toISOString() })),
    stale: stale.map((f) => ({ id: f.id, name: f.originalName, bytes: Number(f.size), lastAccessedAt: f.lastAccessedAt?.toISOString() ?? null, createdAt: f.createdAt.toISOString() })),
    growth,
    duplicates,
  };
}

/** Uploads and downloads for the current workspace. Month totals are metered counters; daily numbers come from real rows. */
export async function transferAnalytics(actor: Actor, days = 30) {
  const scope = scopeOf(actor);
  const ent = await entitlementsForActor(actor);
  const subject = subjectOf(scope);
  const since = new Date(Date.now() - days * DAY);
  const [downloads, uploads, top, monthDown, monthUp, history] = await Promise.all([
    db.download.findMany({ where: { file: scopeWhere(scope), createdAt: { gte: since } }, select: { bytes: true, createdAt: true, shareId: true }, take: 100_000 }),
    db.file.findMany({ where: { ...scopeWhere(scope), createdAt: { gte: since } }, select: { size: true, createdAt: true }, take: 100_000 }),
    db.file.findMany({ where: { ...scopeWhere(scope), deletedAt: null, downloadCount: { gt: 0 } }, orderBy: { downloadCount: "desc" }, take: 10, select: { id: true, originalName: true, downloadCount: true, size: true } }),
    getUsage(subject, "downloadBytes"),
    getUsage(subject, "uploadBytes"),
    usageHistory(subject, "downloadBytes", 6),
  ]);
  const perDay = new Map<string, { downloads: number; downloadBytes: number; uploads: number; uploadBytes: number }>();
  for (const d of lastDays(days)) perDay.set(d, { downloads: 0, downloadBytes: 0, uploads: 0, uploadBytes: 0 });
  for (const d of downloads) {
    const row = perDay.get(isoDay(d.createdAt));
    if (row) {
      row.downloads++;
      row.downloadBytes += Number(d.bytes ?? 0n);
    }
  }
  for (const u of uploads) {
    const row = perDay.get(isoDay(u.createdAt));
    if (row) {
      row.uploads++;
      row.uploadBytes += Number(u.size);
    }
  }
  return {
    advanced: ent.features.advancedAnalytics,
    transferAllowanceBytes: ent.limits.transferBytesPerMonth,
    thisMonth: { downloadBytes: monthDown, uploadBytes: monthUp },
    viaShares: downloads.filter((d) => d.shareId).length,
    daily: [...perDay.entries()].map(([day, v]) => ({ day, ...v })),
    topFiles: ent.features.advancedAnalytics ? top.map((f) => ({ id: f.id, name: f.originalName, downloads: f.downloadCount, bytes: Number(f.size) })) : [],
    monthlyDownloadBytes: ent.features.advancedAnalytics ? history : [],
  };
}

export async function requireAdvancedAnalytics(actor: Actor) {
  await assertFeature(await entitlementsForActor(actor), "advancedAnalytics");
}
