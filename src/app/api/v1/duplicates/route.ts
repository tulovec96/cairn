import { z } from "zod";
import { caller } from "@/server/api";
import { parseQuery, route } from "@/server/http";
import { findDuplicates } from "@/server/services/library";

export const dynamic = "force-dynamic";

const query = z.object({ minSize: z.coerce.number().int().min(0).optional() });

/** Groups of files with identical content (same SHA-256). Nothing is ever removed automatically. */
export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return findDuplicates(actor, parseQuery(ctx.req, query));
});