import { adminCaller } from "@/server/api";
import { parseQuery, route } from "@/server/http";
import { adminListShares, adminShareListSchema } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return adminListShares(parseQuery(ctx.req, adminShareListSchema));
});