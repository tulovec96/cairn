import { z } from "zod";
import { Errors } from "@/server/errors";
import { assertSameOrigin, parseJson, route } from "@/server/http";
import { loadPublicRequest, requestUnlockCookie, tryUnlockRequest } from "@/server/services/fileRequests";

export const dynamic = "force-dynamic";

export const POST = route<{ token: string }>(async (ctx) => {
  assertSameOrigin(ctx.req);
  const r = await loadPublicRequest(ctx.params.token);
  const { password } = await parseJson(ctx.req, z.object({ password: z.string().min(1).max(200) }));
  if (!(await tryUnlockRequest(r, password, ctx.ip))) throw Errors.invalidPassword();
  const cookie = requestUnlockCookie(r);
  ctx.setCookie({ name: cookie.name, value: cookie.value, maxAgeSec: cookie.maxAgeSec });
  return { unlocked: true };
});