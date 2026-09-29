import type { File as FileRow, Folder } from "@prisma/client";
import { db } from "../db";
import { Errors } from "../errors";
import { newId } from "../ids";
import { sanitizeFolderName, uniqueName } from "../security/filenames";
import type { Breadcrumb } from "@/lib/types";
import { scopeWhere, type Scope } from "./actor";

export const MAX_FOLDER_DEPTH = 32;

export async function getOwnedFolder(scope: Scope, id: string, opts?: { includeDeleted?: boolean }): Promise<Folder> {
  const folder = await db.folder.findFirst({ where: { id, ...scopeWhere(scope), ...(opts?.includeDeleted ? {} : { deletedAt: null }) } });
  if (!folder) throw Errors.notFound("That folder doesn't exist.");
  return folder;
}

/** Ancestors from the root down to (and including) `folderId`. Verifies the scope at every step. */
export async function ancestorChain(scope: Scope, folderId: string | null, opts?: { includeDeleted?: boolean }): Promise<Folder[]> {
  const chain: Folder[] = [];
  let currentId = folderId;
  while (currentId) {
    if (chain.length >= MAX_FOLDER_DEPTH + 2) throw Errors.conflict("The folder structure is too deep.");
    const f: Folder | null = await db.folder.findFirst({ where: { id: currentId, ...scopeWhere(scope), ...(opts?.includeDeleted ? {} : { deletedAt: null }) } });
    if (!f) throw Errors.notFound("That folder doesn't exist.");
    chain.unshift(f);
    currentId = f.parentId;
  }
  return chain;
}

export async function breadcrumbs(scope: Scope, folderId: string | null): Promise<Breadcrumb[]> {
  const chain = await ancestorChain(scope, folderId);
  return [{ id: null, name: "All files" }, ...chain.map((f) => ({ id: f.id, name: f.name }))];
}

export async function siblingNames(scope: Scope, parentId: string | null, opts?: { excludeId?: string }): Promise<Set<string>> {
  const rows = await db.folder.findMany({
    where: { ...scopeWhere(scope), parentId, deletedAt: null, ...(opts?.excludeId ? { id: { not: opts.excludeId } } : {}) },
    select: { name: true },
  });
  return new Set(rows.map((r) => r.name.toLowerCase()));
}

/** All descendant folder ids (excluding the root), breadth-first. */
export async function descendantFolderIds(scope: Scope, rootId: string, opts?: { includeDeleted?: boolean }): Promise<string[]> {
  const out: string[] = [];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await db.folder.findMany({
      where: { ...scopeWhere(scope), parentId: { in: frontier }, ...(opts?.includeDeleted ? {} : { deletedAt: null }) },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
    out.push(...frontier);
    if (out.length > 200_000) throw Errors.conflict("This folder contains too many items for this operation.");
  }
  return out;
}

async function subtreeHeight(scope: Scope, rootId: string): Promise<number> {
  let height = 0;
  let frontier = [rootId];
  while (frontier.length) {
    const children = await db.folder.findMany({ where: { ...scopeWhere(scope), parentId: { in: frontier }, deletedAt: null }, select: { id: true } });
    frontier = children.map((c) => c.id);
    if (frontier.length) height++;
  }
  return height;
}

export async function createFolder(scope: Scope, input: { name: string; parentId: string | null; color?: string | null; description?: string }): Promise<Folder> {
  const name = sanitizeFolderName(input.name);
  if (!name) throw Errors.validation("Give the folder a name.");
  const chain = await ancestorChain(scope, input.parentId);
  if (chain.length + 1 > MAX_FOLDER_DEPTH) throw Errors.conflict(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep.`);
  const taken = await siblingNames(scope, input.parentId);
  if (taken.has(name.toLowerCase())) throw Errors.conflict("A folder with that name already exists here.");
  return db.folder.create({
    data: {
      id: newId("fld"),
      ownerId: scope.userId,
      orgId: scope.orgId,
      parentId: input.parentId,
      name,
      nameKey: name.toLowerCase(),
      color: input.color ?? null,
      description: input.description ?? "",
    },
  });
}

export async function renameFolder(scope: Scope, id: string, rawName: string): Promise<Folder> {
  const folder = await getOwnedFolder(scope, id);
  const name = sanitizeFolderName(rawName);
  if (!name) throw Errors.validation("Give the folder a name.");
  const taken = await siblingNames(scope, folder.parentId, { excludeId: id });
  if (taken.has(name.toLowerCase())) throw Errors.conflict("A folder with that name already exists here.");
  return db.folder.update({ where: { id }, data: { name, nameKey: name.toLowerCase() } });
}

export async function updateFolderMeta(scope: Scope, id: string, patch: { color?: string | null; description?: string; archived?: boolean }): Promise<Folder> {
  await getOwnedFolder(scope, id);
  return db.folder.update({
    where: { id },
    data: {
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.description !== undefined ? { description: patch.description.slice(0, 2000) } : {}),
      ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date() : null } : {}),
    },
  });
}

export async function moveFolder(scope: Scope, id: string, targetParentId: string | null): Promise<Folder> {
  const folder = await getOwnedFolder(scope, id);
  if (targetParentId === id) throw Errors.conflict("A folder can't be moved into itself.");
  if (targetParentId) {
    const chain = await ancestorChain(scope, targetParentId);
    if (chain.some((f) => f.id === id)) throw Errors.conflict("A folder can't be moved into one of its own subfolders.");
    const height = await subtreeHeight(scope, id);
    if (chain.length + 1 + height > MAX_FOLDER_DEPTH) throw Errors.conflict(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep.`);
  }
  if (folder.parentId === targetParentId) return folder;
  const taken = await siblingNames(scope, targetParentId);
  const name = uniqueName(folder.name, taken);
  return db.folder.update({ where: { id }, data: { parentId: targetParentId, name, nameKey: name.toLowerCase() } });
}

export async function listAllFolders(scope: Scope): Promise<Array<{ id: string; name: string; parentId: string | null; color: string | null }>> {
  return db.folder.findMany({
    where: { ...scopeWhere(scope), deletedAt: null },
    select: { id: true, name: true, parentId: true, color: true },
    orderBy: { name: "asc" },
    take: 10_000,
  });
}

export interface FolderFileEntry {
  file: FileRow;
  /** Path inside the shared/archived folder, using "/" separators, ending with the file name. */
  path: string;
}

/** Files below the given folders (recursively), each with its relative path. */
export async function collectFolderFiles(
  scope: Scope,
  rootFolderIds: string[],
  opts?: { onlyAvailable?: boolean },
): Promise<FolderFileEntry[]> {
  const roots = await db.folder.findMany({ where: { id: { in: rootFolderIds }, ...scopeWhere(scope), deletedAt: null } });
  const entries: FolderFileEntry[] = [];
  const usedTop = new Set<string>();
  for (const root of roots) {
    const topName = uniqueName(root.name, usedTop);
    usedTop.add(topName.toLowerCase());
    const pathOf = new Map<string, string>([[root.id, topName]]);
    let frontier = [root.id];
    const allIds = [root.id];
    while (frontier.length) {
      const children = await db.folder.findMany({ where: { ...scopeWhere(scope), parentId: { in: frontier }, deletedAt: null }, select: { id: true, name: true, parentId: true } });
      frontier = [];
      for (const c of children) {
        pathOf.set(c.id, `${pathOf.get(c.parentId!)}/${c.name}`);
        frontier.push(c.id);
        allIds.push(c.id);
      }
    }
    const files = await db.file.findMany({
      where: { ...scopeWhere(scope), folderId: { in: allIds }, deletedAt: null, ...(opts?.onlyAvailable ? { status: "available" } : {}) },
      orderBy: { originalName: "asc" },
    });
    const usedInFolder = new Map<string, Set<string>>();
    for (const file of files) {
      const dir = pathOf.get(file.folderId!) ?? topName;
      const taken = usedInFolder.get(dir) ?? new Set<string>();
      const name = uniqueName(file.originalName, taken);
      taken.add(name.toLowerCase());
      usedInFolder.set(dir, taken);
      entries.push({ file, path: `${dir}/${name}` });
    }
  }
  return entries;
}
