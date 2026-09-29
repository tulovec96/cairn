import { caller } from "@/server/api";
import { route } from "@/server/http";
import { orgOverview } from "@/server/services/organizations";

export const dynamic = "force-dynamic";

/** Shared-storage breakdown for the organization workspace the request is made in. */
export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return orgOverview(actor);
});