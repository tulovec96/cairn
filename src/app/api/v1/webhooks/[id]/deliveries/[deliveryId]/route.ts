import { caller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { getDelivery, replayDelivery } from "@/server/services/webhooks";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string; deliveryId: string }>(async (ctx) => {
  const actor = await caller(ctx, "webhooks:write");
  return { delivery: await getDelivery(actor, idParam.parse(ctx.params.id), idParam.parse(ctx.params.deliveryId)) };
});

/** Re-sends the same payload (fresh delivery id and signature). */
export const POST = route<{ id: string; deliveryId: string }>(async (ctx) => {
  const actor = await caller(ctx, "webhooks:write");
  return { delivery: await replayDelivery(actor, idParam.parse(ctx.params.id), idParam.parse(ctx.params.deliveryId)) };
});