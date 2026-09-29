import { adminCaller } from "@/server/api";
import { parseQuery, route } from "@/server/http";
import { adminListQuarantine, quarantineListSchema } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return adminListQuarantine(parseQuery(ctx.req, quarantineListSchema));
});