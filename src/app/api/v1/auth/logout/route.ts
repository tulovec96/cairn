import { assertSameOrigin, readCookie, route, SESSION_COOKIE } from "@/server/http";
import { hashToken } from "@/server/crypto";
import { db } from "@/server/db";
import { audit } from "@/server/services/audit";

export const dynamic = "force-dynamic";

export const POST = route(async (ctx) => {
  assertSameOrigin(ctx.req);
  const token = readCookie(ctx.req, SESSION_COOKIE);
  if (token) {
    const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (session) {
      await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
      await audit({ actorType: "user", actorId: session.userId, action: "auth.logout", ip: ctx.ip });
    }
  }
  ctx.clearCookie(SESSION_COOKIE);
  return { ok: true };
});