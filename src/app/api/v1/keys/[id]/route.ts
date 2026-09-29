import { userCaller } from "@/server/api";
import { idParam, noContent, route } from "@/server/http";
import { requireSessionUser } from "@/server/services/actor";
import { revokeApiKey } from "@/server/services/apikeys";

export const dynamic = "force-dynamic";

export const DELETE = route<{ id: string }>(async (ctx) => {
  await userCaller(ctx);
  const actor = await requireSessionUser(ctx.req);
  await revokeApiKey(actor.user.id, idParam.parse(ctx.params.id), ctx.ip);
  return noContent();
});
