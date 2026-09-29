import type { File as FileRow, FileVersion } from "@prisma/client";
import { db } from "../db";
import { Errors } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { storage } from "../storage";
import { thumbKeysOf } from "../storage/keys";
import { isUnlimited } from "@/config/entitlements";
import { ownerWhere, scopeOf, workspaceIdOf, type Actor } from "./actor";
import { assertFeature, entitlementsForActor, entitlementsForScope } from "./limits";
import { assertCan } from "./permissions";

export interface VersionDto {
  version: number;
  current: boolean;
  size: number;
  sha256: string;
  mime: string;
  createdAt: string;
  createdBy: string | null;
  note: string | null;
}

async function actorFile(actor: Actor, id: string): Promise<FileRow> {
  const file = await db.file.findFirst({ where: { id, ...ownerWhere(actor), deletedAt: null } });
  if (!file) throw Errors.notFound();
  return file;
}

export async function listVersions(actor: Actor, fileId: string): Promise<VersionDto[]> {
  const file = await actorFile(actor, fileId);
  const older = await db.fileVersion.findMany({ where: { fileId }, orderBy: { version: "desc" } });
  const ids = [...new Set([file.ownerId, ...older.map((v) => v.createdById).filter((x): x is string => !!x)])];
  const people = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })).map((u) => [u.id, u.displayName]));
  return [
    { version: file.version, current: true, size: Number(file.size), sha256: file.sha256, mime: file.mime, createdAt: file.updatedAt.toISOString(), createdBy: people.get(file.ownerId) ?? null, note: null },
    ...older.map((v) => ({ version: v.version, current: false, size: Number(v.size), sha256: v.sha256, mime: v.mime, createdAt: v.createdAt.toISOString(), createdBy: v.createdById ? (people.get(v.createdById) ?? null) : null, note: v.note })),
  ];
}

/** Deletes versions beyond what the plan allows (count and age), oldest first. */
export async function pruneVersions(fileId: string, scope: { userId: string; orgId: string | null }): Promise<number> {
  const ent = await entitlementsForScope(scope);
  const keep = ent.limits.versionsPerFile;
  const days = ent.limits.versionRetentionDays;
  const versions = await db.fileVersion.findMany({ where: { fileId }, orderBy: { version: "desc" } });
  const cutoff = isUnlimited(days) ? null : Date.now() - days * 86400_000;
  const doomed = versions.filter((v, i) => (!isUnlimited(keep) && i >= keep) || (cutoff !== null && v.createdAt.getTime() < cutoff));
  for (const v of doomed) {
    await storage().delete(v.storageKey).catch(() => undefined);
    await db.fileVersion.delete({ where: { id: v.id } });
  }
  return doomed.length;
}

/** Turns the file's current content into a stored version. Called when new content replaces it. */
export async function archiveCurrentAsVersion(file: FileRow, createdById: string | null, note?: string): Promise<FileVersion> {
  return db.fileVersion.create({
    data: {
      id: newId("ver"),
      fileId: file.id,
      version: file.version,
      storageKey: file.storageKey,
      size: file.size,
      sha256: file.sha256,
      mime: file.mime,
      createdById: createdById ?? file.ownerId,
      note: note ?? null,
      createdAt: file.updatedAt,
    },
  });
}

/** Makes an older version the current one. The replaced content is kept as a new version, so nothing is ever lost. */
export async function restoreVersion(actor: Actor, fileId: string, versionNumber: number): Promise<{ version: number }> {
  assertCan(actor, "write");
  const ent = await entitlementsForActor(actor);
  await assertFeature(ent, "fileVersioning");
  const file = await actorFile(actor, fileId);
  const target = await db.fileVersion.findUnique({ where: { fileId_version: { fileId, version: versionNumber } } });
  if (!target) throw Errors.notFound("That version doesn't exist.");
  const newVersion = file.version + 1;
  await db.$transaction(async (tx) => {
    await tx.fileVersion.create({
      data: { id: newId("ver"), fileId, version: file.version, storageKey: file.storageKey, size: file.size, sha256: file.sha256, mime: file.mime, createdById: actor.user.id, note: `Replaced when v${versionNumber} was restored`, createdAt: file.updatedAt },
    });
    await tx.fileVersion.delete({ where: { id: target.id } });
    await tx.file.update({
      where: { id: fileId },
      data: { storageKey: target.storageKey, size: target.size, sha256: target.sha256, mime: target.mime, version: newVersion, thumbnailKey: null, scanStatus: file.scanStatus },
    });
  });
  for (const key of thumbKeysOf(file.thumbnailKey)) await storage().delete(key).catch(() => undefined);
  const { enqueueJob } = await import("../jobs/queue");
  await enqueueJob("thumbnail", { fileId }, { dedupeKey: `thumb:${fileId}:${newVersion}` });
  await pruneVersions(fileId, scopeOf(actor));
  await emit({ type: "file.version_restored", workspaceId: workspaceIdOf(scopeOf(actor)), ownerId: file.ownerId, orgId: file.orgId, actorId: actor.user.id, actorLabel: actor.user.displayName, fileId, targetName: file.originalName, data: { restored: versionNumber, now: newVersion } });
  return { version: newVersion };
}

export async function deleteVersion(actor: Actor, fileId: string, versionNumber: number): Promise<void> {
  assertCan(actor, "delete");
  await actorFile(actor, fileId);
  const v = await db.fileVersion.findUnique({ where: { fileId_version: { fileId, version: versionNumber } } });
  if (!v) throw Errors.notFound("That version doesn't exist (the current version can't be deleted here).");
  await storage().delete(v.storageKey).catch(() => undefined);
  await db.fileVersion.delete({ where: { id: v.id } });
}

export async function getVersionForDownload(actor: Actor, fileId: string, versionNumber: number) {
  const file = await actorFile(actor, fileId);
  if (versionNumber === file.version) return { file, storageKey: file.storageKey, sha256: file.sha256, mime: file.mime, size: Number(file.size), version: file.version };
  const v = await db.fileVersion.findUnique({ where: { fileId_version: { fileId, version: versionNumber } } });
  if (!v) throw Errors.notFound("That version doesn't exist.");
  return { file, storageKey: v.storageKey, sha256: v.sha256, mime: v.mime, size: Number(v.size), version: v.version };
}
