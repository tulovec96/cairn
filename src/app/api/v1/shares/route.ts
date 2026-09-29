import { caller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { createShareSchema } from "@/server/schemas";
import { createShare, listShares } from "@/server/services/shares";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return { items: await listShares(actor) };
});

export const POST = route(async (ctx) => {
  const actor = await caller(ctx, "shares:write");
  const input = await parseJson(ctx.req, createShareSchema);
  return { share: await createShare(actor, input, ctx.ip) };
}, { status: 201 });
