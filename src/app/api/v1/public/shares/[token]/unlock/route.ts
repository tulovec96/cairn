import { z } from "zod";
import { Errors } from "@/server/errors";
import { assertSameOrigin, parseJson, route } from "@/server/http";
import { resolveShare, tryUnlockShare, unlockCookieFor } from "@/server/services/shares";

export const dynamic = "force-dynamic";

const schema = z.object({ password: z.string().min(1).max(200) });

/** Verifies a share password (rate limited) and sets a short-lived, signed unlock cookie for that link. */
export const POST = route<{ token: string }>(async (ctx) => {
  assertSameOrigin(ctx.req);
  const { share } = await resolveShare(ctx.params.token);
  const { password } = await parseJson(ctx.req, schema);
  const ok = await tryUnlockShare(share, password, ctx.ip);
  if (!ok) throw Errors.invalidPassword();
  const cookie = unlockCookieFor(share);
  ctx.setCookie({ name: cookie.name, value: cookie.value, maxAgeSec: cookie.maxAgeSec });
  return { unlocked: true };
});
