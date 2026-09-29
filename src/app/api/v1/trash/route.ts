import { caller } from "@/server/api";
import { route } from "@/server/http";
import { scopeOf } from "@/server/services/actor";
import { assertCan } from "@/server/services/permissions";
import { emptyTrash, listTrash } from "@/server/services/trash";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return { items: await listTrash(scopeOf(actor)) };
});

/** Permanently deletes everything in the trash. */
export const DELETE = route(async (ctx) => {
  const actor = await caller(ctx, "files:delete");
  assertCan(actor, "delete");
  return { destroyed: await emptyTrash(actor, ctx.ip) };
});
