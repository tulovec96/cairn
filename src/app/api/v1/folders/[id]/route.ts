import { z } from "zod";
import { caller, nullableId } from "@/server/api";
import { db } from "@/server/db";
import { idParam, parseJson, route } from "@/server/http";
import { scopeOf, type Scope } from "@/server/services/actor";
import { breadcrumbs, getOwnedFolder, moveFolder, renameFolder, updateFolderMeta } from "@/server/services/folders";
import { setFavorites } from "@/server/services/files";
import { assertCan } from "@/server/services/permissions";
import { serializeFolder } from "@/server/services/serializers";
import { deleteItems } from "@/server/services/trash";

export const dynamic = "force-dynamic";

async function load(scope: Scope, viewerId: string, id: string) {
  await getOwnedFolder(scope, id);
  const folder = await db.folder.findUniqueOrThrow({
    where: { id },
    include: { shares: { where: { revokedAt: null }, orderBy: { createdAt: "desc" }, take: 20 }, favorites: { where: { userId: viewerId }, select: { id: true } } },
  });
  return serializeFolder(folder);
}

export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  const id = idParam.parse(ctx.params.id);
  const scope = scopeOf(actor);
  return { folder: await load(scope, actor.user.id, id), path: await breadcrumbs(scope, id) };
});

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentId: nullableId.optional(),
  favorite: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  description: z.string().max(2000).optional(),
  archived: z.boolean().optional(),
});

export const PATCH = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "folders:write");
  assertCan(actor, "write");
  const id = idParam.parse(ctx.params.id);
  const patch = await parseJson(ctx.req, patchSchema);
  const scope = scopeOf(actor);
  if (patch.name !== undefined) await renameFolder(scope, id, patch.name);
  if (patch.parentId !== undefined) await moveFolder(scope, id, patch.parentId);
  if (patch.color !== undefined || patch.description !== undefined || patch.archived !== undefined) await updateFolderMeta(scope, id, patch);
  if (patch.favorite !== undefined) await setFavorites(actor, { folderIds: [id] }, patch.favorite);
  return { folder: await load(scope, actor.user.id, id) };
});

/** Moves the folder (and everything inside it) to the trash. */
export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:delete");
  const id = idParam.parse(ctx.params.id);
  await getOwnedFolder(scopeOf(actor), id);
  const result = await deleteItems(actor, { folderIds: [id] }, ctx.ip);
  return { trashed: result.trashed, trashIds: result.batches };
});
