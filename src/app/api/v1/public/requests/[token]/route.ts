import { route } from "@/server/http";
import * as rate from "@/server/ratelimit";
import { getSettings } from "@/server/settings";
import { describeRequest } from "@/server/services/fileRequests";

export const dynamic = "force-dynamic";

/** What an uploader sees before sending anything: the request's name, limits and branding. */
export const GET = route<{ token: string }>(async (ctx) => {
  const settings = await getSettings();
  rate.enforce(`req-info:${ctx.ip}`, settings.rateLimits.download);
  return { request: await describeRequest(ctx.req, ctx.params.token) };
});