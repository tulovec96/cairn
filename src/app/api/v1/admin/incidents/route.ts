import { adminCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { adminIncidents, createIncident, incidentSchema } from "@/server/services/content";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return { items: await adminIncidents() };
});

export const POST = route(async (ctx) => {
  const admin = await adminCaller(ctx);
  return { incident: await createIncident(admin.user.id, await parseJson(ctx.req, incidentSchema)) };
}, { status: 201 });