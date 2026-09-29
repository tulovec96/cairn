import { caller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { bulkSchema, runBulk } from "@/server/services/bulk";

export const dynamic = "force-dynamic";

/**
 * Applies one action to many items: delete, move, favorite, unfavorite, expiry, share, restore, purge.
 * Partial failures are reported per id in `failed`.
 */
export const POST = route(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  const input = await parseJson(ctx.req, bulkSchema, 256 * 1024);
  return runBulk(actor, input, ctx.ip);
});
