import type { File as FileRow, Prisma } from "@prisma/client";
import { db } from "../db";
import { Errors } from "../errors";
import { emit } from "../events";
import { newId, newStorageKey } from "../ids";
import { sanitizeFilename, uniqueName } from "../security/filenames";
import { getSettings } from "../settings";
import { storage } from "../storage";
import { thumbKeysOf } from "../storage/keys";
import { extensionOf, type FileCategory } from "@/lib/fileTypes";
import { isEmptyQuery, parseQuery } from "@/lib/search";
import type { Breadcrumb, FileDto, FileListResponse, FolderDto } from "@/lib/types";
import { ownerWhere, scopeOf, scopeWhere, workspaceIdOf, type Actor } from "./actor";
import { breadcrumbs, getOwnedFolder } from "./folders";
import { assertUploadAllowed, checkExtension, entitlementsForActor, limitsFromEntitlements, resolveExpiry } from "./limits";
import { assertCan } from "./permissions";
import { activeShareWhere, compileFileFilters, mentionsArchived } from "./search";
import { serializeFile, serializeFolder, serializeShare } from "./serializers";

export type SortField = "name" | "size" | "created" | "modified" | "downloads" | "type";
export type RecentBy = "uploaded" | "modified" | "accessed" | "shared";
export type ListView = "all" | "recent" | "favorites" | "shared" | "archived";

export interface ListQuery {
  view: ListView;
  folderId: string | null;
  q?: string;
  type?: FileCategory;
  sort: SortField;
  order: "asc" | "desc";
  by?: RecentBy;
  scope?: "folder" | "everywhere";
  cursor?: string;
  limit: number;
}

export { activeShareWhere };

export function fileInclude(actor: Actor) {
  return {
    shares: { where: { revokedAt: null }, orderBy: { createdAt: "desc" as const }, take: 20 },
    favorites: { where: { userId: actor.user.id }, select: { id: true } },
    tags: { include: { tag: true } },
    _count: { select: { comments: { where: { deletedAt: null } }, versions: true } },
  } satisfies Prisma.FileInclude;
}

function orderFor(sort: SortField, order: "asc" | "desc"): Prisma.FileOrderByWithRelationInput[] {
  switch (sort) {
    case "size":
      return [{ size: order }, { id: "asc" }];
    case "created":
      return [{ createdAt: order }, { id: "asc" }];
    case "modified":
      return [{ updatedAt: order }, { id: "asc" }];
    case "downloads":
      return [{ downloadCount: order }, { id: "asc" }];
    case "type":
      return [{ category: order }, { extension: order }, { id: "asc" }];
    default:
      return [{ nameKey: order }, { id: "asc" }];
  }
}

export async function listFiles(actor: Actor, q: ListQuery): Promise<FileListResponse> {
  const scope = scopeOf(actor);
  const parsed = parseQuery(q.q);
  const searching = !isEmptyQuery(parsed) || !!q.type;
  const and = await compileFileFilters(parsed, { scope });
  const where: Prisma.FileWhereInput = { ...scopeWhere(scope), deletedAt: null, AND: and };
  if (q.type) where.category = q.type;
  if (q.view !== "archived" && !mentionsArchived(parsed)) where.archivedAt = null;

  const folderWhere: Prisma.FolderWhereInput = { ...scopeWhere(scope), deletedAt: null };
  const wordFilters = parsed.words.filter((w) => !w.negate);
  if (wordFilters.length) folderWhere.AND = wordFilters.map((w) => ({ nameKey: { contains: w.text } }));
  const fileOnlyQuery = parsed.filters.length > 0 || !!q.type;
  let crumbs: Breadcrumb[] = [];
  let orderBy = orderFor(q.sort, q.order);
  let take = q.limit;

  switch (q.view) {
    case "all": {
      const everywhere = searching && q.scope !== "folder";
      if (!everywhere) {
        where.folderId = q.folderId;
        folderWhere.parentId = q.folderId;
        crumbs = await breadcrumbs(scope, q.folderId);
      } else if (q.folderId) {
        crumbs = await breadcrumbs(scope, q.folderId);
      }
      folderWhere.archivedAt = null;
      break;
    }
    case "archived":
      where.archivedAt = { not: null };
      folderWhere.archivedAt = { not: null };
      break;
    case "favorites":
      where.favorites = { some: { userId: actor.user.id } };
      folderWhere.favorites = { some: { userId: actor.user.id } };
      break;
    case "shared":
      where.shares = { some: activeShareWhere() };
      folderWhere.shares = { some: activeShareWhere() };
      break;
    case "recent": {
      take = Math.min(take, 50);
      switch (q.by ?? "uploaded") {
        case "modified":
          orderBy = [{ updatedAt: "desc" }, { id: "asc" }];
          break;
        case "accessed":
          where.lastAccessedAt = { not: null };
          orderBy = [{ lastAccessedAt: "desc" }, { id: "asc" }];
          break;
        case "shared": {
          const shares = await db.shareLink.findMany({
            where: { ...(scope.orgId ? { file: { orgId: scope.orgId } } : { ownerId: scope.userId }), fileId: { not: null }, ...activeShareWhere() },
            orderBy: { createdAt: "desc" },
            distinct: ["fileId"],
            take,
            select: { fileId: true },
          });
          const ids = shares.map((s) => s.fileId!);
          const rows = await db.file.findMany({ where: { ...where, id: { in: ids } }, include: fileInclude(actor) });
          rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
          return { folders: [], files: rows.map((r) => serializeFile(r)), nextCursor: null, breadcrumbs: [], total: rows.length, queryErrors: parsed.errors };
        }
        default:
          orderBy = [{ createdAt: "desc" }, { id: "asc" }];
      }
      break;
    }
  }

  const rows = await db.file.findMany({
    where,
    orderBy,
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    include: fileInclude(actor),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  let folders: FolderDto[] = [];
  if (!q.cursor && q.view !== "recent" && !fileOnlyQuery) {
    const folderRows = await db.folder.findMany({
      where: folderWhere,
      orderBy: { nameKey: q.order },
      take: 1000,
      include: {
        shares: { where: { revokedAt: null }, orderBy: { createdAt: "desc" }, take: 20 },
        favorites: { where: { userId: actor.user.id }, select: { id: true } },
      },
    });
    folders = folderRows.map(serializeFolder);
  }
  const total = await db.file.count({ where });
  return { folders, files: page.map((r) => serializeFile(r)), nextCursor: hasMore ? page[page.length - 1].id : null, breadcrumbs: crumbs, total, queryErrors: parsed.errors };
}

export async function getFileRow(actor: Actor, id: string, opts?: { includeDeleted?: boolean }): Promise<FileRow> {
  const file = await db.file.findFirst({ where: { id, ...ownerWhere(actor), ...(opts?.includeDeleted ? {} : { deletedAt: null }) } });
  if (!file) throw Errors.notFound();
  return file;
}

export async function getFileDto(actor: Actor, id: string, opts?: { includeDeleted?: boolean }): Promise<FileDto> {
  const file = await db.file.findFirst({
    where: { id, ...ownerWhere(actor), ...(opts?.includeDeleted ? {} : { deletedAt: null }) },
    include: { ...fileInclude(actor), owner: { select: { id: true, displayName: true } } },
  });
  if (!file) throw Errors.notFound();
  return serializeFile(file, { includeOwner: true });
}

export interface FileDetails {
  file: FileDto;
  path: Breadcrumb[];
  shares: FileDto["share"][];
}

export async function getFileDetails(actor: Actor, id: string): Promise<FileDetails> {
  const dto = await getFileDto(actor, id, { includeDeleted: true });
  const shares = await db.shareLink.findMany({ where: { fileId: id }, orderBy: { createdAt: "desc" }, take: 50 });
  const path = await breadcrumbs(scopeOf(actor), dto.folderId).catch(() => [{ id: null, name: "All files" }]);
  return { file: dto, path, shares: shares.map((s) => serializeShare(s, dto.name)) };
}

export async function touchAccessed(fileId: string) {
  await db.file.updateMany({ where: { id: fileId }, data: { lastAccessedAt: new Date() } }).catch(() => undefined);
}

export interface FilePatch {
  name?: string;
  folderId?: string | null;
  expiresAt?: Date | null;
  description?: string;
  notes?: string;
  colorLabel?: string | null;
  metadata?: Record<string, string>;
  archived?: boolean;
}

async function namesInFolder(actor: Actor, folderId: string | null, excludeId?: string): Promise<Set<string>> {
  const rows = await db.file.findMany({
    where: { ...ownerWhere(actor), folderId, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { originalName: true },
  });
  return new Set(rows.map((r) => r.originalName.toLowerCase()));
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function sanitizeMetadata(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input).slice(0, 30)) {
    const key = k.trim().slice(0, 60);
    if (!key || /[\u0000-\u001f]/.test(key)) continue;
    out[key] = String(v).slice(0, 500);
  }
  return out;
}

export async function updateFile(actor: Actor, id: string, patch: FilePatch): Promise<FileDto> {
  assertCan(actor, "write");
  const file = await getFileRow(actor, id);
  const data: Prisma.FileUpdateInput = {};
  const events: Array<Parameters<typeof emit>[0]> = [];
  const base = { workspaceId: workspaceIdOf(scopeOf(actor)), ownerId: file.ownerId, orgId: file.orgId, actorId: actor.user.id, actorLabel: actor.user.displayName, fileId: id };

  if (patch.name !== undefined) {
    const name = sanitizeFilename(patch.name, "");
    if (!name) throw Errors.validation("Give the file a name.");
    const ext = extensionOf(name);
    checkExtension(await getSettings(), ext);
    const taken = await namesInFolder(actor, file.folderId, id);
    if (taken.has(name.toLowerCase())) throw Errors.conflict("A file with that name already exists in this folder.");
    data.originalName = name;
    data.safeName = name;
    data.nameKey = name.toLowerCase();
    data.extension = ext;
    if (name !== file.originalName) events.push({ ...base, type: "file.renamed", targetName: name, data: { from: file.originalName } });
  }

  if (patch.folderId !== undefined && patch.folderId !== file.folderId) {
    if (patch.folderId) await getOwnedFolder(scopeOf(actor), patch.folderId);
    const taken = await namesInFolder(actor, patch.folderId, id);
    const finalName = uniqueName((data.originalName as string | undefined) ?? file.originalName, taken);
    data.folder = patch.folderId ? { connect: { id: patch.folderId } } : { disconnect: true };
    data.originalName = finalName;
    data.safeName = finalName;
    data.nameKey = finalName.toLowerCase();
    events.push({ ...base, type: "file.moved", targetName: finalName, folderId: patch.folderId, data: { fromFolderId: file.folderId } });
  }

  if (patch.expiresAt !== undefined) {
    const ent = await entitlementsForActor(actor);
    data.expiresAt = resolveExpiry(limitsFromEntitlements(ent), patch.expiresAt);
  }
  if (patch.description !== undefined) data.description = patch.description.slice(0, 2000);
  if (patch.notes !== undefined) data.notes = patch.notes.slice(0, 10_000);
  if (patch.colorLabel !== undefined) {
    if (patch.colorLabel !== null && !COLOR_RE.test(patch.colorLabel)) throw Errors.validation("Colors must look like #2557e8.");
    data.colorLabel = patch.colorLabel;
  }
  if (patch.metadata !== undefined) data.metadata = JSON.stringify(sanitizeMetadata(patch.metadata));
  if (patch.archived !== undefined) data.archivedAt = patch.archived ? new Date() : null;

  const updated = await db.file.update({ where: { id }, data, include: { ...fileInclude(actor), owner: { select: { id: true, displayName: true } } } });
  for (const e of events) await emit(e);
  return serializeFile(updated, { includeOwner: true });
}

/** Copies a file (blob included) into a folder. Counts against the quota like any other upload. */
export async function copyFile(actor: Actor, id: string, opts: { folderId?: string | null; name?: string } = {}): Promise<FileDto> {
  assertCan(actor, "write");
  const src = await getFileRow(actor, id);
  if (src.status !== "available") throw Errors.conflict("Only files that finished processing can be copied.");
  const scope = scopeOf(actor);
  const ent = await entitlementsForActor(actor);
  await assertUploadAllowed(scope, ent, { size: Number(src.size), ext: src.extension });
  const folderId = opts.folderId === undefined ? src.folderId : opts.folderId;
  if (folderId) await getOwnedFolder(scope, folderId);
  const taken = await namesInFolder(actor, folderId);
  const dot = src.originalName.lastIndexOf(".");
  const wanted = opts.name
    ? sanitizeFilename(opts.name)
    : dot > 0
      ? `${src.originalName.slice(0, dot)} (copy)${src.originalName.slice(dot)}`
      : `${src.originalName} (copy)`;
  const name = uniqueName(wanted, taken);
  const key = newStorageKey();
  await storage().copy(src.storageKey, key);
  const copy = await db.file.create({
    data: {
      id: newId("fil"),
      ownerId: actor.user.id,
      orgId: scope.orgId,
      folderId,
      originalName: name,
      nameKey: name.toLowerCase(),
      safeName: name,
      mime: src.mime,
      extension: extensionOf(name) || src.extension,
      category: src.category,
      size: src.size,
      storageKey: key,
      sha256: src.sha256,
      description: src.description,
      notes: src.notes,
      colorLabel: src.colorLabel,
      metadata: src.metadata,
      mediaInfo: src.mediaInfo,
      status: "available",
      scanStatus: src.scanStatus === "clean" ? "clean" : src.scanStatus === "infected" ? "not_scanned" : src.scanStatus,
    },
  });
  const tags = await db.fileTag.findMany({ where: { fileId: id } });
  if (tags.length) await db.fileTag.createMany({ data: tags.map((t) => ({ fileId: copy.id, tagId: t.tagId })) });
  if (copy.category === "image") {
    const { enqueueJob } = await import("../jobs/queue");
    await enqueueJob("thumbnail", { fileId: copy.id }, { dedupeKey: `thumb:${copy.id}` });
  }
  await emit({ type: "file.copied", workspaceId: workspaceIdOf(scope), ownerId: actor.user.id, orgId: scope.orgId, actorId: actor.user.id, actorLabel: actor.user.displayName, fileId: copy.id, targetName: name, data: { sourceFileId: id } });
  return getFileDto(actor, copy.id);
}

export async function setFavorites(actor: Actor, input: { fileIds?: string[]; folderIds?: string[] }, value: boolean): Promise<number> {
  const userId = actor.user.id;
  let changed = 0;
  if (input.fileIds?.length) {
    const files = await db.file.findMany({ where: { id: { in: input.fileIds }, ...ownerWhere(actor), deletedAt: null }, select: { id: true } });
    for (const f of files) {
      if (value) await db.favorite.upsert({ where: { userId_fileId: { userId, fileId: f.id } }, create: { id: newId("fav"), userId, fileId: f.id }, update: {} });
      else await db.favorite.deleteMany({ where: { userId, fileId: f.id } });
      changed++;
    }
  }
  if (input.folderIds?.length) {
    const folders = await db.folder.findMany({ where: { id: { in: input.folderIds }, ...ownerWhere(actor), deletedAt: null }, select: { id: true } });
    for (const f of folders) {
      if (value) await db.favorite.upsert({ where: { userId_folderId: { userId, folderId: f.id } }, create: { id: newId("fav"), userId, folderId: f.id }, update: {} });
      else await db.favorite.deleteMany({ where: { userId, folderId: f.id } });
      changed++;
    }
  }
  return changed;
}

/** Deletes blobs (current, thumbnail and every stored version) first, then rows. Blob failures are logged; the GC job retries orphans. */
export async function destroyFiles(files: Array<Pick<FileRow, "id" | "storageKey" | "thumbnailKey">>): Promise<void> {
  if (!files.length) return;
  const provider = storage();
  const versions = await db.fileVersion.findMany({ where: { fileId: { in: files.map((f) => f.id) } }, select: { storageKey: true } });
  for (const key of [...files.map((f) => f.storageKey), ...files.flatMap((f) => thumbKeysOf(f.thumbnailKey)), ...versions.map((v) => v.storageKey)]) {
    await provider.delete(key).catch((err) => console.error("[storage] delete failed", key, (err as Error).message));
  }
  for (let i = 0; i < files.length; i += 500) {
    await db.file.deleteMany({ where: { id: { in: files.slice(i, i + 500).map((f) => f.id) } } });
  }
}

export function fileCanBeServed(file: Pick<FileRow, "status" | "deletedAt" | "expiresAt">) {
  if (file.deletedAt) throw Errors.notFound();
  if (file.expiresAt && file.expiresAt.getTime() <= Date.now()) throw Errors.gone("This file has expired.");
  if (file.status === "quarantined") throw Errors.quarantined();
  if (file.status === "processing" || file.status === "scanning") throw Errors.scanPending();
  if (file.status === "failed") throw Errors.notFound();
}
