import { caller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { fileActivity } from "@/server/services/activity";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return { items: await fileActivity(actor, idParam.parse(ctx.params.id)) };
});