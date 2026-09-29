import { caller } from "@/server/api";
import { route } from "@/server/http";
import { storageAnalytics } from "@/server/services/analytics";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "usage:read");
  return storageAnalytics(actor);
});