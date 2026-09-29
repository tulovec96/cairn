import { z } from "zod";
import { caller } from "@/server/api";
import { idParam, noContent, parseJson, route } from "@/server/http";
import { deleteComment, editComment } from "@/server/services/comments";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  const { body } = await parseJson(ctx.req, z.object({ body: z.string().trim().min(1).max(4000) }));
  return { comment: await editComment(actor, idParam.parse(ctx.params.id), body) };
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  await deleteComment(actor, idParam.parse(ctx.params.id));
  return noContent();
});