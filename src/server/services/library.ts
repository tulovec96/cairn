import { z } from "zod";
import { db } from "../db";
import { Errors } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { sanitizeFilename } from "../security/filenames";
import { checkExtension } from "./limits";
import { getSettings } from "../settings";
import { computeBatchRename, type RenameRow } from "@/lib/batchRename";
import { extensionOf } from "@/lib/fileTypes";
import { parseQuery } from "@/lib/search";
import { ownerWhere, scopeOf, scopeWhere, workspaceIdOf, type Actor, type Scope } from "./actor";
import { assertCan } from "./permissions";

// ---------------------------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------------------------

export interface SavedSearchDto {
  id: string;
  name: string;
  query: string;
  pinned: boolean;
  createdAt: string;
}

export const savedSearchSchema = z.object({
  name: z.string().trim().min(1, "Give the search a name.").max(60),
  query: z.string().trim().min(1, "Enter a search first.").max(500),
  pinned: z.boolean().optional(),
});

const toSaved = (s: { id: string; name: string; query: string; pinned: boolean; createdAt: Date }): SavedSearchDto => ({ id: s.id, name: s.name, query: s.query, pinned: s.pinned, createdAt: s.createdAt.toISOString() });

export async function listSavedSearches(actor: Actor): Promise<SavedSearchDto[]> {
  const rows = await db.savedSearch.findMany({ where: { userId: actor.user.id }, orderBy: [{ pinned: "desc" }, { name: "asc" }], take: 200 });
  return rows.map(toSaved);
}

export async function createSavedSearch(actor: Actor, input: z.infer<typeof savedSearchSchema>): Promise<SavedSearchDto> {
  const parsed = parseQuery(input.query);
  if (parsed.errors.length) throw Errors.validation(parsed.errors[0]);
  if ((await db.savedSearch.count({ where: { userId: actor.user.id } })) >= 100) throw Errors.conflict("You can keep up to 100 saved searches.");
  return toSaved(await db.savedSearch.create({ data: { id: newId("sch"), userId: actor.user.id, name: input.name, query: input.query, pinned: input.pinned ?? false } }));
}

export async function updateSavedSearch(actor: Actor, id: string, patch: Partial<z.infer<typeof savedSearchSchema>>): Promise<SavedSearchDto> {
  const s = await db.savedSearch.findFirst({ where: { id, userId: actor.user.id } });
  if (!s) throw Errors.notFound("That saved search doesn't exist.");
  if (patch.query) {
    const parsed = parseQuery(patch.query);
    if (parsed.errors.length) throw Errors.validation(parsed.errors[0]);
  }
  return toSaved(await db.savedSearch.update({ where: { id }, data: { ...(patch.name ? { name: patch.name } : {}), ...(patch.query ? { query: patch.query } : {}), ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}) } }));
}

export async function deleteSavedSearch(actor: Actor, id: string): Promise<void> {
  const { count } = await db.savedSearch.deleteMany({ where: { id, userId: actor.user.id } });
  if (!count) throw Errors.notFound("That saved search doesn't exist.");
}

// ---------------------------------------------------------------------------------------------
// Duplicate detection (exact matches by SHA-256; nothing is ever deleted automatically)
// ---------------------------------------------------------------------------------------------

export interface DuplicateGroup {
  sha256: string;
  size: number;
  files: Array<{ id: string; name: string; location: string; createdAt: string; downloads: number; shared: boolean }>;
  reclaimableBytes: number;
}

async function folderPathMap(scope: Scope): Promise<Map<string, string>> {
  const folders = await db.folder.findMany({ where: { ...scopeWhere(scope), deletedAt: null }, select: { id: true, name: true, parentId: true }, take: 20_000 });
  const byId = new Map(folders.map((f) => [f.id, f]));
  const cache = new Map<string, string>();
  const pathOf = (id: string): string => {
    const hit = cache.get(id);
    if (hit) return hit;
    const parts: string[] = [];
    let cur = byId.get(id);
    for (let i = 0; cur && i < 40; i++) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    const p = `/${parts.join("/")}`;
    cache.set(id, p);
    return p;
  };
  return new Map(folders.map((f) => [f.id, pathOf(f.id)]));
}

export async function findDuplicates(actor: Actor, opts: { minSize?: number } = {}): Promise<{ groups: DuplicateGroup[]; reclaimableBytes: number }> {
  const scope = scopeOf(actor);
  const base = { ...scopeWhere(scope), deletedAt: null, archivedAt: null, status: "available", size: { gte: BigInt(opts.minSize ?? 1) } };
  const dupes = await db.file.groupBy({ by: ["sha256"], where: base, _count: { _all: true }, having: { sha256: { _count: { gt: 1 } } }, orderBy: { _count: { sha256: "desc" } }, take: 200 });
  if (!dupes.length) return { groups: [], reclaimableBytes: 0 };
  const files = await db.file.findMany({
    where: { ...base, sha256: { in: dupes.map((d) => d.sha256) } },
    select: { id: true, originalName: true, folderId: true, size: true, sha256: true, createdAt: true, downloadCount: true, shares: { where: { revokedAt: null }, select: { id: true }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });
  const paths = await folderPathMap(scope);
  const groups = new Map<string, DuplicateGroup>();
  for (const f of files) {
    const g = groups.get(f.sha256) ?? { sha256: f.sha256, size: Number(f.size), files: [], reclaimableBytes: 0 };
    g.files.push({ id: f.id, name: f.originalName, location: f.folderId ? (paths.get(f.folderId) ?? "/") : "/", createdAt: f.createdAt.toISOString(), downloads: f.downloadCount, shared: f.shares.length > 0 });
    groups.set(f.sha256, g);
  }
  const list = [...groups.values()].filter((g) => g.files.length > 1);
  for (const g of list) g.reclaimableBytes = g.size * (g.files.length - 1);
  list.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes);
  return { groups: list, reclaimableBytes: list.reduce((n, g) => n + g.reclaimableBytes, 0) };
}

// ---------------------------------------------------------------------------------------------
// Batch rename
// ---------------------------------------------------------------------------------------------

export const batchRenameSchema = z.object({
  fileIds: z.array(z.string().max(40)).min(1).max(500),
  pattern: z.string().trim().min(1, "Enter a naming pattern.").max(200),
  start: z.number().int().min(0).max(1_000_000).optional(),
});

export async function previewBatchRename(actor: Actor, input: z.infer<typeof batchRenameSchema>): Promise<RenameRow[]> {
  const files = await db.file.findMany({
    where: { id: { in: input.fileIds }, ...ownerWhere(actor), deletedAt: null },
    select: { id: true, originalName: true, folderId: true, createdAt: true },
    orderBy: [{ nameKey: "asc" }, { id: "asc" }],
  });
  if (!files.length) throw Errors.notFound("None of those files exist.");
  const folderIds = [...new Set(files.map((f) => f.folderId))];
  const namedFolders = folderIds.filter((f): f is string => f !== null);
  const others = await db.file.findMany({
    where: { ...ownerWhere(actor), deletedAt: null, OR: [{ folderId: { in: namedFolders } }, ...(folderIds.includes(null) ? [{ folderId: null }] : [])], id: { notIn: files.map((f) => f.id) } },
    select: { folderId: true, originalName: true },
  });
  const existing = new Map<string | null, Set<string>>();
  for (const o of others) {
    const set = existing.get(o.folderId) ?? new Set<string>();
    set.add(o.originalName.toLowerCase());
    existing.set(o.folderId, set);
  }
  return computeBatchRename(files.map((f) => ({ id: f.id, name: f.originalName, folderId: f.folderId, createdAt: f.createdAt.toISOString() })), input.pattern, { start: input.start, existing });
}

export async function applyBatchRename(actor: Actor, input: z.infer<typeof batchRenameSchema>): Promise<{ renamed: number }> {
  assertCan(actor, "write");
  const rows = await previewBatchRename(actor, input);
  const conflict = rows.find((r) => r.conflict);
  if (conflict) throw Errors.conflict(`Can't rename "${conflict.from}": ${conflict.conflict === "duplicate" ? "two files would get the same name" : conflict.conflict === "exists" ? "a file with that name already exists" : "the new name isn't valid"}.`);
  const settings = await getSettings();
  const scope = scopeOf(actor);
  let renamed = 0;
  for (const r of rows) {
    if (r.to === r.from) continue;
    const name = sanitizeFilename(r.to, "");
    if (!name) continue;
    checkExtension(settings, extensionOf(name));
    const file = await db.file.update({ where: { id: r.id }, data: { originalName: name, safeName: name, nameKey: name.toLowerCase(), extension: extensionOf(name) } });
    await emit({ type: "file.renamed", workspaceId: workspaceIdOf(scope), ownerId: file.ownerId, orgId: file.orgId, actorId: actor.user.id, actorLabel: actor.user.displayName, fileId: file.id, targetName: name, data: { from: r.from, batch: true } });
    renamed++;
  }
  return { renamed };
}
