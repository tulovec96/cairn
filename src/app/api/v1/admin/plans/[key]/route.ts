import { z } from "zod";
import { adminCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { adminUpdatePlan, planPatchSchema } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

const keyParam = z.string().regex(/^[a-z][a-z0-9_-]{1,29}$/);

/** Edit a plan's price, features and limits. Changes apply to everyone on the plan immediately. */
export const PATCH = route<{ key: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  return { plan: await adminUpdatePlan(admin.user.id, keyParam.parse(ctx.params.key), await parseJson(ctx.req, planPatchSchema), ctx.ip) };
});