import { adminCaller } from "@/server/api";
import { parseJson, parseQuery, route } from "@/server/http";
import { adminAssignPlan, adminListSubscriptions, assignPlanSchema, subscriptionListSchema } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return adminListSubscriptions(parseQuery(ctx.req, subscriptionListSchema));
});

/** Assign a plan to a user or organization. */
export const POST = route(async (ctx) => {
  const admin = await adminCaller(ctx);
  await adminAssignPlan(admin.user.id, await parseJson(ctx.req, assignPlanSchema), ctx.ip);
  return { ok: true };
});