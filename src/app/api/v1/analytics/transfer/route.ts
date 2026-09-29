import { z } from "zod";
import { caller } from "@/server/api";
import { parseQuery, route } from "@/server/http";
import { transferAnalytics } from "@/server/services/analytics";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "usage:read");
  const { days } = parseQuery(ctx.req, z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }));
  return transferAnalytics(actor, days);
});