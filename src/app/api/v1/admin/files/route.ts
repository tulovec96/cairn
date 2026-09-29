import { adminCaller } from "@/server/api";
import { parseQuery, route } from "@/server/http";
import { listAdminFiles, listAdminFilesSchema } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return listAdminFiles(parseQuery(ctx.req, listAdminFilesSchema));
});
