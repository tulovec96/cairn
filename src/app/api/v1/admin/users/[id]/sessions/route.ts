import { adminCaller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { revokeUserSessions } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const DELETE = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  return { revoked: await revokeUserSessions(admin, idParam.parse(ctx.params.id), ctx.ip) };
});
