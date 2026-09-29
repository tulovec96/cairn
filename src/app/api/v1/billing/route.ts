import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { cancelSubscription, getBillingState, resumeSubscription, startCheckout, billingPortalUrl } from "@/server/services/billing";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return getBillingState(actor);
});

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("checkout"), plan: z.string().min(1).max(40), interval: z.enum(["month", "year"]).default("month") }),
  z.object({ action: z.literal("portal") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("resume") }),
]);

/** Billing actions for the current workspace: start checkout, open the card portal, cancel or resume. */
export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const input = await parseJson(ctx.req, schema);
  switch (input.action) {
    case "checkout":
      return startCheckout(actor, input.plan, input.interval);
    case "portal":
      return billingPortalUrl(actor);
    case "cancel":
      return cancelSubscription(actor);
    case "resume":
      await resumeSubscription(actor);
      return { ok: true };
  }
});