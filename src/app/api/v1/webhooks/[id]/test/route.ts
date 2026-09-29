import { caller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { testWebhook } from "@/server/services/webhooks";

export const dynamic = "force-dynamic";

/** Sends a signed `webhook.test` event right now and reports the endpoint's answer. */
export const POST = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "webhooks:write");
  return { delivery: await testWebhook(actor, idParam.parse(ctx.params.id)) };
});