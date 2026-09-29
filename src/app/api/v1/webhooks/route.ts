import { caller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { createWebhook, listWebhooks, webhookSchema } from "@/server/services/webhooks";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "webhooks:write");
  return { items: await listWebhooks(actor) };
});

/** The signing secret is returned once, in this response only. */
export const POST = route(async (ctx) => {
  const actor = await caller(ctx, "webhooks:write");
  return createWebhook(actor, await parseJson(ctx.req, webhookSchema));
}, { status: 201 });