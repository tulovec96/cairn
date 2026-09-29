import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { idParam, noContent, parseJson, route } from "@/server/http";
import { changeMemberRole, removeMember } from "@/server/services/organizations";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string; memberId: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { role } = await parseJson(ctx.req, z.object({ role: z.enum(["admin", "member", "viewer"]) }));
  await changeMemberRole(actor, idParam.parse(ctx.params.id), idParam.parse(ctx.params.memberId), role, ctx.ip);
  return { ok: true };
});

/** Removes a member, or lets a member leave (their own membership id). */
export const DELETE = route<{ id: string; memberId: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  await removeMember(actor, idParam.parse(ctx.params.id), idParam.parse(ctx.params.memberId), ctx.ip);
  return noContent();
});