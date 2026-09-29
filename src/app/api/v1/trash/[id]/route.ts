import { caller } from "@/server/api";
import { Errors } from "@/server/errors";
import { idParam, route } from "@/server/http";
import { scopeOf } from "@/server/services/actor";
import { assertCan } from "@/server/services/permissions";
import { purgeTrashItem, restoreTrashItem } from "@/server/services/trash";

export const dynamic = "force-dynamic";

/** Restores a trash entry (file or folder). The id is the trash entry id from GET /trash. */
export const POST = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  await restoreTrashItem(actor, idParam.parse(ctx.params.id), ctx.ip);
  return { ok: true };
});

/** Permanently deletes one trash entry. */
export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:delete");
  assertCan(actor, "delete");
  const destroyed = await purgeTrashItem(scopeOf(actor), idParam.parse(ctx.params.id));
  if (destroyed === 0) throw Errors.notFound("That item is no longer in the trash.");
  return { destroyed };
});
