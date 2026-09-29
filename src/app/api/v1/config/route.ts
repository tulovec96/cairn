import { optionalCaller } from "@/server/api";
import { route } from "@/server/http";
import { buildPublicConfig } from "@/server/services/config";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await optionalCaller(ctx);
  return { config: await buildPublicConfig(actor) };
});