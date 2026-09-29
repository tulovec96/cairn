import { caller } from "@/server/api";
import { idParam, noContent, parseJson, route } from "@/server/http";
import { automationSchema, deleteAutomation, updateAutomation } from "@/server/services/automations";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "automations:write");
  return { automation: await updateAutomation(actor, idParam.parse(ctx.params.id), await parseJson(ctx.req, automationSchema.partial())) };
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "automations:write");
  await deleteAutomation(actor, idParam.parse(ctx.params.id));
  return noContent();
});