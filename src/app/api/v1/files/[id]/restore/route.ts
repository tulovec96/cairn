import { caller } from "@/server/api";
import { db } from "@/server/db";
import { Errors } from "@/server/errors";
import { idParam, route } from "@/server/http";
import { scopeWhere, scopeOf } from "@/server/services/actor";
import { restoreTrashItem } from "@/server/services/trash";

export const dynamic = "force-dynamic";

/** Restores a trashed file to its original folder (or the root if that folder is gone). */
export const POST = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  const id = idParam.parse(ctx.params.id);
  const file = await db.file.findFirst({ where: { id, ...scopeWhere(scopeOf(actor)), deletedAt: { not: null } }, select: { trashBatchId: true } });
  if (!file?.trashBatchId) throw Errors.notFound("That file isn't in the trash.");
  await restoreTrashItem(actor, file.trashBatchId, ctx.ip);
  return { ok: true };
});
