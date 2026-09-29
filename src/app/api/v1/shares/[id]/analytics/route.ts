import { z } from "zod";
import { caller } from "@/server/api";
import { assertFeature } from "@/server/services/entitlements";
import { entitlementsForActor } from "@/server/services/limits";
import { idParam, parseQuery, route } from "@/server/http";
import { shareAnalytics } from "@/server/services/shares";

export const dynamic = "force-dynamic";

const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/** Views, downloads and referring sites for one link. Counts only: visitors are never identified. */
export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  await assertFeature(await entitlementsForActor(actor), "shareAnalytics");
  return shareAnalytics(actor, idParam.parse(ctx.params.id), parseQuery(ctx.req, query).days);
});
