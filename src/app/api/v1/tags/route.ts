import { z } from "zod";
import { caller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { createTag, listTags } from "@/server/services/tags";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return { items: await listTags(actor) };
});

const schema = z.object({ name: z.string().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });

export const POST = route(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  return { tag: await createTag(actor, await parseJson(ctx.req, schema)) };
}, { status: 201 });