import { z } from "zod";
import { caller } from "@/server/api";
import { idParam, parseQuery, route } from "@/server/http";
import { listDeliveries } from "@/server/services/webhooks";

export const dynamic = "force-dynamic";

const query = z.object({ cursor: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });

export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "webhooks:write");
  return listDeliveries(actor, idParam.parse(ctx.params.id), parseQuery(ctx.req, query));
});