import { sessionCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { createOrg, listMyOrgs, orgNameSchema } from "@/server/services/organizations";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { items: await listMyOrgs(actor) };
});

export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { organization: await createOrg(actor, await parseJson(ctx.req, orgNameSchema), ctx.ip) };
}, { status: 201 });