import { sessionCaller } from "@/server/api";
import { route } from "@/server/http";
import { listSessions, revokeOtherSessions } from "@/server/services/auth";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { items: await listSessions(actor.user.id, actor.sessionId) };
});

/** Signs out every other browser/device. */
export const DELETE = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { revoked: await revokeOtherSessions(actor.user.id, actor.sessionId, ctx.ip) };
});