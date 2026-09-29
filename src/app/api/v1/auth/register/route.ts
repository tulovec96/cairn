import { assertSameOrigin, parseJson, route, SESSION_COOKIE, userAgentOf } from "@/server/http";
import { registerSchema, registerUser } from "@/server/services/auth";
import { serializeUser } from "@/server/services/serializers";

export const dynamic = "force-dynamic";

export const POST = route(async (ctx) => {
  assertSameOrigin(ctx.req);
  const input = await parseJson(ctx.req, registerSchema);
  const { user, session } = await registerUser(input, { ip: ctx.ip, userAgent: userAgentOf(ctx.req) });
  ctx.setCookie({ name: SESSION_COOKIE, value: session.token, maxAgeSec: session.maxAgeSec });
  return { user: serializeUser(user) };
}, { status: 201 });