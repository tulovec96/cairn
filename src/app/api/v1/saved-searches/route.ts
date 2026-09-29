import { sessionCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { createSavedSearch, listSavedSearches, savedSearchSchema } from "@/server/services/library";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { items: await listSavedSearches(actor) };
});

export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { search: await createSavedSearch(actor, await parseJson(ctx.req, savedSearchSchema)) };
}, { status: 201 });