import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { parseJson, route, WORKSPACE_COOKIE } from "@/server/http";
import { resolveWorkspace } from "@/server/services/actor";

export const dynamic = "force-dynamic";

/** Switches between your personal files and an organization you belong to. Membership is verified. */
export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { orgId } = await parseJson(ctx.req, z.object({ orgId: z.string().max(40).nullable() }));
  const ws = await resolveWorkspace(actor.user.id, orgId, true);
  if (ws.orgId) ctx.setCookie({ name: WORKSPACE_COOKIE, value: ws.orgId, maxAgeSec: 365 * 86400 });
  else ctx.clearCookie(WORKSPACE_COOKIE);
  return { workspace: { orgId: ws.orgId, role: ws.role, name: ws.orgName ?? null } };
});