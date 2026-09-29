import { route } from "@/server/http";
import * as rate from "@/server/ratelimit";
import { getSettings } from "@/server/settings";
import { describeShare } from "@/server/services/publicShares";

export const dynamic = "force-dynamic";

/** Public metadata for a share link (name, size, preview kind, scan state). Password-protected links reveal nothing until unlocked. */
export const GET = route<{ token: string }>(async (ctx) => {
  const settings = await getSettings();
  rate.enforce(`share-info:${ctx.ip}`, settings.rateLimits.download);
  return { share: await describeShare(ctx.req, ctx.params.token, ctx.ip) };
});
