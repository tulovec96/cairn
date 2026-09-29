import { caller } from "@/server/api";
import { idParam, noContent, parseJson, route } from "@/server/http";
import { deleteRequest, requestPatchSchema, updateRequest } from "@/server/services/fileRequests";

export const dynamic = "force-dynamic";

/** Edit a request or portal, or close/reopen it with { "closed": true | false }. */
export const PATCH = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "shares:write");
  return { request: await updateRequest(actor, idParam.parse(ctx.params.id), await parseJson(ctx.req, requestPatchSchema), ctx.ip) };
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "shares:write");
  await deleteRequest(actor, idParam.parse(ctx.params.id), ctx.ip);
  return noContent();
});