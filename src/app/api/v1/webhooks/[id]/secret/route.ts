import { caller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { rotateWebhookSecret } from "@/server/services/webhooks";

export const dynamic = "force-dynamic";

/** Replaces the signing secret. The new one is shown once. */
export const POST = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "webhooks:write");
  return rotateWebhookSecret(actor, idParam.parse(ctx.params.id));
});