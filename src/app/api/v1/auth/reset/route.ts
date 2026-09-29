import { assertSameOrigin, parseJson, route } from "@/server/http";
import { resetPassword, resetSchema } from "@/server/services/auth";

export const dynamic = "force-dynamic";

export const POST = route(async (ctx) => {
  assertSameOrigin(ctx.req);
  const input = await parseJson(ctx.req, resetSchema);
  await resetPassword(input, { ip: ctx.ip, userAgent: null });
  return { ok: true };
});