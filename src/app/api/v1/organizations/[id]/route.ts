import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { idParam, noContent, parseJson, route } from "@/server/http";
import { deleteOrg, getOrg, orgNameSchema, updateOrg } from "@/server/services/organizations";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return getOrg(actor, idParam.parse(ctx.params.id));
});

export const PATCH = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const input = await parseJson(ctx.req, orgNameSchema.partial().extend({ timezone: z.string().max(64).optional() }));
  return { organization: await updateOrg(actor, idParam.parse(ctx.params.id), input, ctx.ip) };
});

/** Deletes the organization and all of its files. Body: { "confirm": "<organization name>" }. */
export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { confirm } = await parseJson(ctx.req, z.object({ confirm: z.string().max(100) }));
  await deleteOrg(actor, idParam.parse(ctx.params.id), confirm, ctx.ip);
  return noContent();
});