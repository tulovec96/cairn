import { sessionCaller } from "@/server/api";
import { idParam, route, SESSION_COOKIE } from "@/server/http";
import { revokeSession } from "@/server/services/auth";

export const dynamic = "force-dynamic";

export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const id = idParam.parse(ctx.params.id);
  await revokeSession(actor.user.id, id, ctx.ip);
  if (id === actor.sessionId) ctx.clearCookie(SESSION_COOKIE);
  return { ok: true };
});