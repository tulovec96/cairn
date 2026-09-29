import { Errors } from "@/server/errors";
import { assertSameOrigin, route } from "@/server/http";
import * as rate from "@/server/ratelimit";
import { getSettings } from "@/server/settings";
import { assertShareUnlocked, consumeShareView, recordShareEvent, resolveShare } from "@/server/services/shares";

export const dynamic = "force-dynamic";

/**
 * Counted once per opening of the share page (the page calls this after it renders). It applies the link's
 * view limit and feeds the owner's analytics. Nothing about the visitor is stored, only that a view happened.
 */
export const POST = route<{ token: string }>(async (ctx) => {
  assertSameOrigin(ctx.req);
  const settings = await getSettings();
  rate.enforce(`share-view:${ctx.ip}`, settings.rateLimits.download);
  const { share } = await resolveShare(ctx.params.token, { forPage: true, ip: ctx.ip });
  assertShareUnlocked(ctx.req, share);
  if (!(await consumeShareView(share))) throw Errors.gone("This link has reached its view limit.");
  await recordShareEvent(share.id, "view", { referrer: ctx.req.headers.get("referer") }).catch(() => undefined);
  return { counted: true };
});
