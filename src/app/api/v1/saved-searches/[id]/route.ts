import { sessionCaller } from "@/server/api";
import { idParam, noContent, parseJson, route } from "@/server/http";
import { deleteSavedSearch, savedSearchSchema, updateSavedSearch } from "@/server/services/library";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { search: await updateSavedSearch(actor, idParam.parse(ctx.params.id), await parseJson(ctx.req, savedSearchSchema.partial())) };
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  await deleteSavedSearch(actor, idParam.parse(ctx.params.id));
  return noContent();
});