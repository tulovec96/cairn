import { caller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { addComment, commentSchema, listComments } from "@/server/services/comments";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return { items: await listComments(actor, idParam.parse(ctx.params.id)) };
});

export const POST = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  return { comment: await addComment(actor, idParam.parse(ctx.params.id), await parseJson(ctx.req, commentSchema)) };
}, { status: 201 });