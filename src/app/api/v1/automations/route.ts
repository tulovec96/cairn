import { caller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { automationSchema, createAutomation, listAutomations } from "@/server/services/automations";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "automations:read");
  return { items: await listAutomations(actor) };
});

export const POST = route(async (ctx) => {
  const actor = await caller(ctx, "automations:write");
  return { automation: await createAutomation(actor, await parseJson(ctx.req, automationSchema)) };
}, { status: 201 });