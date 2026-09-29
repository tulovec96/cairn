import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { route } from "@/server/http";
import * as rate from "@/server/ratelimit";
import { acceptInvite, describeInvite } from "@/server/services/organizations";

export const dynamic = "force-dynamic";

const tokenSchema = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/);

/** What an invitation is for (organization, role, invited address). Needed to render the accept page. */
export const GET = route<{ token: string }>(async (ctx) => {
  rate.enforce(`invite-info:${ctx.ip}`, { limit: 60, windowSec: 300 });
  return describeInvite(tokenSchema.parse(ctx.params.token));
});

export const POST = route<{ token: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { organization: await acceptInvite(actor, tokenSchema.parse(ctx.params.token), ctx.ip) };
});