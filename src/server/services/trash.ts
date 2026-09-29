import { db } from "../db";
import { Errors } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { uniqueName } from "../security/filenames";
import type { TrashItemDto } from "@/lib/types";
import { isUnlimited } from "@/config/entitlements";
import { actorLabel, scopeOf, scopeWhere, workspaceIdOf, type Actor, type Scope } from "./actor";
import { audit } from "./audit";
import { entitlementsForActor, entitlementsForScope } from "./limits";
import { descendantFolderIds, siblingNames } from "./folders";
import { destroyFiles } from "./files";
import { assertCan } from "./permissions";

const CHUNK = 500;
function* chunks<T>(list: T[], size = CHUNK): Generator<T[]> {
  for (let i = 0; i < list.length; i += size) yield list.slice(i, i + size);
}

export interface DeleteInput {
  fileIds?: string[];
  folderIds?: string[];
}

export interface DeleteResult {
  trashed: number;
  /** Trash entry ids created by this call (usable for undo via restore). */
  batches: string[];
}

/** Deleting moves items to the trash; they stay restorable for the plan's trash retention period. */
export async function deleteItems(actor: Actor, input: DeleteInput, ip?: string): Promise<DeleteResult> {
  assertCan(actor, "delete");
  const result: DeleteResult = { trashed: 0, batches: [] };
  const fileIds = [...new Set(input.fileIds ?? [])];
  const folderIds = [...new Set(input.folderIds ?? [])];
  const scope = scopeOf(actor);
  const ent = await entitlementsForActor(actor);
  const days = ent.limits.trashRetentionDays;
  const purgeAt = new Date(Date.now() + (isUnlimited(days) ? 3650 : Math.max(1, days)) * 86400_000);
  const now = new Date();
  const base = { workspaceId: workspaceIdOf(scope), ownerId: actor.user.id, orgId: scope.orgId, actorId: actor.user.id, actorLabel: actor.user.displayName };

  for (const id of fileIds) {
    const file = await db.file.findFirst({ where: { id, ...scopeWhere(scope), deletedAt: null } });
    if (!file) continue;
    const batch = newId("bat");
    await db.$transaction([
      db.file.update({ where: { id }, data: { deletedAt: now, trashBatchId: batch } }),
      db.trashItem.create({ data: { id: batch, ownerId: actor.user.id, orgId: scope.orgId, kind: "file", itemId: id, name: file.originalName, size: file.size, itemCount: 1, deletedAt: now, purgeAt } }),
    ]);
    result.trashed++;
    result.batches.push(batch);
    await emit({ ...base, type: "file.deleted", fileId: id, targetName: file.originalName });
    await audit({ ...actorLabel(actor), action: "file.deleted", targetType: "file", targetId: id, ip, metadata: { name: file.originalName } });
  }

  for (const id of folderIds) {
    const folder = await db.folder.findFirst({ where: { id, ...scopeWhere(scope), deletedAt: null } });
    if (!folder) continue;
    const ids = [id, ...(await descendantFolderIds(scope, id))];
    const batch = newId("bat");
    let size = 0n;
    let count = 0;
    for (const part of chunks(ids)) {
      const agg = await db.file.aggregate({ where: { ...scopeWhere(scope), folderId: { in: part }, deletedAt: null }, _sum: { size: true }, _count: true });
      size += agg._sum.size ?? 0n;
      count += agg._count;
    }
    for (const part of chunks(ids)) {
      await db.folder.updateMany({ where: { id: { in: part }, ...scopeWhere(scope), deletedAt: null }, data: { deletedAt: now, trashBatchId: batch } });
      await db.file.updateMany({ where: { ...scopeWhere(scope), folderId: { in: part }, deletedAt: null }, data: { deletedAt: now, trashBatchId: batch } });
    }
    await db.trashItem.create({ data: { id: batch, ownerId: actor.user.id, orgId: scope.orgId, kind: "folder", itemId: id, name: folder.name, size, itemCount: count + ids.length, deletedAt: now, purgeAt } });
    result.trashed++;
    result.batches.push(batch);
    await emit({ ...base, type: "folder.deleted", folderId: id, targetName: folder.name, data: { files: count } });
    await audit({ ...actorLabel(actor), action: "folder.deleted", targetType: "folder", targetId: id, ip, metadata: { name: folder.name, files: count } });
  }
  return result;
}

function trashWhere(scope: Scope) {
  return scope.orgId ? { orgId: scope.orgId } : { ownerId: scope.userId, orgId: null };
}

export async function listTrash(scope: Scope): Promise<TrashItemDto[]> {
  const rows = await db.trashItem.findMany({ where: trashWhere(scope), orderBy: { deletedAt: "desc" }, take: 1000 });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as "file" | "folder",
    itemId: r.itemId,
    name: r.name,
    size: Number(r.size),
    itemCount: r.itemCount,
    deletedAt: r.deletedAt.toISOString(),
    purgeAt: r.purgeAt.toISOString(),
  }));
}

export async function restoreTrashItem(actor: Actor, batchId: string, ip?: string): Promise<void> {
  assertCan(actor, "write");
  const scope = scopeOf(actor);
  const item = await db.trashItem.findFirst({ where: { id: batchId, ...trashWhere(scope) } });
  if (!item) throw Errors.notFound("That item is no longer in the trash.");
  const base = { workspaceId: workspaceIdOf(scope), ownerId: actor.user.id, orgId: scope.orgId, actorId: actor.user.id, actorLabel: actor.user.displayName };

  if (item.kind === "file") {
    const file = await db.file.findFirst({ where: { id: item.itemId, ...scopeWhere(scope), trashBatchId: batchId } });
    if (!file) {
      await db.trashItem.delete({ where: { id: batchId } });
      throw Errors.notFound("That file no longer exists.");
    }
    let folderId = file.folderId;
    if (folderId) {
      const parent = await db.folder.findFirst({ where: { id: folderId, ...scopeWhere(scope), deletedAt: null }, select: { id: true } });
      if (!parent) folderId = null;
    }
    const taken = new Set((await db.file.findMany({ where: { ...scopeWhere(scope), folderId, deletedAt: null }, select: { originalName: true } })).map((f) => f.originalName.toLowerCase()));
    const name = uniqueName(file.originalName, taken);
    await db.$transaction([
      db.file.update({ where: { id: file.id }, data: { deletedAt: null, trashBatchId: null, folderId, originalName: name, safeName: name, nameKey: name.toLowerCase() } }),
      db.trashItem.delete({ where: { id: batchId } }),
    ]);
    await emit({ ...base, type: "file.restored", fileId: file.id, targetName: name });
    await audit({ ...actorLabel(actor), action: "file.restored", targetType: "file", targetId: file.id, ip });
    return;
  }

  const folder = await db.folder.findFirst({ where: { id: item.itemId, ...scopeWhere(scope), trashBatchId: batchId } });
  if (!folder) {
    await db.trashItem.delete({ where: { id: batchId } });
    throw Errors.notFound("That folder no longer exists.");
  }
  let parentId = folder.parentId;
  if (parentId) {
    const parent = await db.folder.findFirst({ where: { id: parentId, ...scopeWhere(scope), deletedAt: null }, select: { id: true } });
    if (!parent) parentId = null;
  }
  const taken = await siblingNames(scope, parentId);
  const name = uniqueName(folder.name, taken);
  await db.$transaction([
    db.folder.update({ where: { id: folder.id }, data: { parentId, name, nameKey: name.toLowerCase() } }),
    db.folder.updateMany({ where: { ...scopeWhere(scope), trashBatchId: batchId }, data: { deletedAt: null, trashBatchId: null } }),
    db.file.updateMany({ where: { ...scopeWhere(scope), trashBatchId: batchId }, data: { deletedAt: null, trashBatchId: null } }),
    db.trashItem.delete({ where: { id: batchId } }),
  ]);
  await emit({ ...base, type: "file.restored", folderId: folder.id, targetName: name });
  await audit({ ...actorLabel(actor), action: "file.restored", targetType: "folder", targetId: folder.id, ip });
}

/** Permanently removes one trash entry, its files' blobs and versions, and any nested trash entries. */
export async function purgeTrashItem(scope: Scope, batchId: string): Promise<number> {
  const item = await db.trashItem.findFirst({ where: { id: batchId, ...trashWhere(scope) } });
  if (!item) return 0;
  let destroyed = 0;

  if (item.kind === "file") {
    const files = await db.file.findMany({ where: { ...scopeWhere(scope), trashBatchId: batchId } });
    await destroyFiles(files);
    destroyed += files.length;
  } else {
    const root = await db.folder.findFirst({ where: { id: item.itemId, ...scopeWhere(scope) } });
    if (root) {
      const ids = [root.id, ...(await descendantFolderIds(scope, root.id, { includeDeleted: true }))];
      // Files nested in this subtree may carry their own (earlier) trash batch; they must go too or their blobs would leak.
      const nestedBatches = new Set<string>();
      for (const part of chunks(ids)) {
        const files = await db.file.findMany({ where: { ...scopeWhere(scope), folderId: { in: part } } });
        for (const f of files) if (f.trashBatchId && f.trashBatchId !== batchId) nestedBatches.add(f.trashBatchId);
        await destroyFiles(files);
        destroyed += files.length;
      }
      await db.folder.deleteMany({ where: { id: root.id, ...scopeWhere(scope) } });
      if (nestedBatches.size) await db.trashItem.deleteMany({ where: { id: { in: [...nestedBatches] } } });
    }
  }
  await db.trashItem.deleteMany({ where: { id: batchId } });
  return destroyed;
}

export async function emptyTrash(actor: Actor, ip?: string): Promise<number> {
  assertCan(actor, "delete");
  const scope = scopeOf(actor);
  const items = await db.trashItem.findMany({ where: trashWhere(scope), select: { id: true } });
  let destroyed = 0;
  for (const i of items) destroyed += await purgeTrashItem(scope, i.id);
  await audit({ ...actorLabel(actor), action: "file.purged", ip, metadata: { items: items.length, files: destroyed } });
  return destroyed;
}

export async function purgeExpiredTrash(limit = 200): Promise<number> {
  const due = await db.trashItem.findMany({ where: { purgeAt: { lte: new Date() } }, take: limit, select: { id: true, ownerId: true, orgId: true } });
  let n = 0;
  for (const i of due) n += await purgeTrashItem({ userId: i.ownerId, orgId: i.orgId }, i.id);
  return n;
}

export { entitlementsForScope };
