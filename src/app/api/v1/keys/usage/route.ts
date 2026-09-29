import { sessionCaller } from "@/server/api";
import { route } from "@/server/http";
import { apiUsageSummary } from "@/server/services/apikeys";

export const dynamic = "force-dynamic";

/** Requests made with your API keys over the last two weeks: counts, errors, endpoints and latency. */
export const GET = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return apiUsageSummary(actor.user.id);
});