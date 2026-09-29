import { sessionCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { createApiKey, createKeySchema, listApiKeys } from "@/server/services/apikeys";

export const dynamic = "force-dynamic";

// Key management is deliberately limited to browser sessions: an API key can't mint or list other keys.
export const GET = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { items: await listApiKeys(actor.user.id) };
});

/** The response contains the full key exactly once. Only a hash is stored. */
export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const input = await parseJson(ctx.req, createKeySchema);
  return createApiKey(actor.user.id, input, ctx.ip);
}, { status: 201 });