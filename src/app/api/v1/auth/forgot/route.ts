import { assertSameOrigin, parseJson, route } from "@/server/http";
import { forgotSchema, requestPasswordReset } from "@/server/services/auth";

export const dynamic = "force-dynamic";

/** Always answers the same way, whether or not the address has an account. */
export const POST = route(async (ctx) => {
  assertSameOrigin(ctx.req);
  const { email } = await parseJson(ctx.req, forgotSchema);
  await requestPasswordReset(email, { ip: ctx.ip, userAgent: null });
  return { ok: true };
});