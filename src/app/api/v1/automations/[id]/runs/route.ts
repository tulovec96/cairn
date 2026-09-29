import { caller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { listRuns } from "@/server/services/automations";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "automations:read");
  return { items: await listRuns(actor, idParam.parse(ctx.params.id)) };
});