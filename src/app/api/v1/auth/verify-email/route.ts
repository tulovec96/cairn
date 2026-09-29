import { z } from "zod";
import { assertSameOrigin, parseJson, route } from "@/server/http";
import { verifyEmail } from "@/server/services/auth";

export const dynamic = "force-dynamic";

export const POST = route(async (ctx) => {
  assertSameOrigin(ctx.req);
  const { token } = await parseJson(ctx.req, z.object({ token: z.string().min(20).max(200) }));
  await verifyEmail(token);
  return { ok: true };
});