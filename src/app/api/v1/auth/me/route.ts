import { optionalCaller } from "@/server/api";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { entitlementsForActor } from "@/server/services/limits";
import { serializeUser } from "@/server/services/serializers";

export const dynamic = "force-dynamic";

/** Who am I, in which workspace, and what does my plan include. */
export const GET = route(async (ctx) => {
  const actor = await optionalCaller(ctx);
  if (!actor) return { user: null };
  const [ent, memberships] = await Promise.all([
    entitlementsForActor(actor),
    db.organizationMember.findMany({ where: { userId: actor.user.id }, include: { org: { select: { id: true, name: true, slug: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    user: serializeUser(actor.user),
    via: actor.via,
    scopes: [...actor.scopes],
    workspace: { orgId: actor.workspace.orgId, role: actor.workspace.role, name: actor.workspace.orgName ?? null },
    organizations: memberships.map((m) => ({ id: m.org.id, name: m.org.name, slug: m.org.slug, role: m.role })),
    plan: { key: ent.planKey, name: ent.planName, features: ent.features, limits: ent.limits },
  };
});