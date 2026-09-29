import { caller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { createRequest, listRequests, requestSchema } from "@/server/services/fileRequests";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return { items: await listRequests(actor) };
});

export const POST = route(async (ctx) => {
  const actor = await caller(ctx, "shares:write");
  return { request: await createRequest(actor, await parseJson(ctx.req, requestSchema), ctx.ip) };
}, { status: 201 });