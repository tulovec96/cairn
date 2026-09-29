import { adminCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { adminCreatePlan, adminListPlans, planCreateSchema } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return { items: await adminListPlans() };
});

export const POST = route(async (ctx) => {
  const admin = await adminCaller(ctx);
  return { plan: await adminCreatePlan(admin.user.id, await parseJson(ctx.req, planCreateSchema), ctx.ip) };
}, { status: 201 });