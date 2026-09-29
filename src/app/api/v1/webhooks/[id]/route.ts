import { caller } from "@/server/api";
import { idParam, noContent, parseJson, route } from "@/server/http";
import { deleteWebhook, updateWebhook, webhookSchema } from "@/server/services/webhooks";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "webhooks:write");
  return { webhook: await updateWebhook(actor, idParam.parse(ctx.params.id), await parseJson(ctx.req, webhookSchema.partial())) };
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "webhooks:write");
  await deleteWebhook(actor, idParam.parse(ctx.params.id));
  return noContent();
});