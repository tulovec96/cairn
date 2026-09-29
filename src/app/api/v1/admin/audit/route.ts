import { adminCaller } from "@/server/api";
import { parseQuery, route } from "@/server/http";
import { listAudit, listAuditSchema } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return listAudit(parseQuery(ctx.req, listAuditSchema));
});
