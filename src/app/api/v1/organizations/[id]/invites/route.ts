import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { idParam, noContent, parseJson, parseQuery, route } from "@/server/http";
import { inviteMember, inviteSchema, revokeInvite } from "@/server/services/organizations";

export const dynamic = "force-dynamic";

/** Invites someone by email. The invitation link is returned too, in case no email provider is configured. */
export const POST = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return inviteMember(actor, idParam.parse(ctx.params.id), await parseJson(ctx.req, inviteSchema), ctx.ip);
}, { status: 201 });

export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { inviteId } = parseQuery(ctx.req, z.object({ inviteId: idParam }));
  await revokeInvite(actor, idParam.parse(ctx.params.id), inviteId);
  return noContent();
});