import { assertSameOrigin, parseJson, route, SESSION_COOKIE, userAgentOf } from "@/server/http";
import { loginSchema, loginUser } from "@/server/services/auth";
import { serializeUser } from "@/server/services/serializers";

export const dynamic = "force-dynamic";

/** Password sign-in. Accounts with two-factor authentication answer 401 `two_factor_required` until a `code` is supplied. */
export const POST = route(async (ctx) => {
  assertSameOrigin(ctx.req);
  const input = await parseJson(ctx.req, loginSchema);
  const { user, session } = await loginUser(input, { ip: ctx.ip, userAgent: userAgentOf(ctx.req) });
  ctx.setCookie({ name: SESSION_COOKIE, value: session.token, maxAgeSec: session.maxAgeSec });
  return { user: serializeUser(user) };
});