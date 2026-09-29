import { adminCaller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { incidentSchema, updateIncident } from "@/server/services/content";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  return { incident: await updateIncident(admin.user.id, idParam.parse(ctx.params.id), await parseJson(ctx.req, incidentSchema.partial())) };
});