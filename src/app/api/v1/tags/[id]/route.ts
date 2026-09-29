import { z } from "zod";
import { caller } from "@/server/api";
import { idParam, noContent, parseJson, route } from "@/server/http";
import { deleteTag, updateTag } from "@/server/services/tags";

export const dynamic = "force-dynamic";

const schema = z.object({ name: z.string().min(1).max(40).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });

export const PATCH = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  return { tag: await updateTag(actor, idParam.parse(ctx.params.id), await parseJson(ctx.req, schema)) };
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  await deleteTag(actor, idParam.parse(ctx.params.id));
  return noContent();
});