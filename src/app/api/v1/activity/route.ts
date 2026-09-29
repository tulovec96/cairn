import { z } from "zod";
import { caller } from "@/server/api";
import { parseQuery, route } from "@/server/http";
import { workspaceActivity } from "@/server/services/activity";

export const dynamic = "force-dynamic";

const query = z.object({ cursor: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), action: z.string().max(30).optional() });

/** What happened in this workspace: uploads, downloads, renames, moves, deletes and shares. */
export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return workspaceActivity(actor, parseQuery(ctx.req, query));
});