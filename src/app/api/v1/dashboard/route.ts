import { caller } from "@/server/api";
import { route } from "@/server/http";
import { dashboardFor } from "@/server/services/dashboard";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return dashboardFor(actor);
});