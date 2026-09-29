import { adminCaller } from "@/server/api";
import { parseQuery, route } from "@/server/http";
import { listUsers, listUsersSchema } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return listUsers(parseQuery(ctx.req, listUsersSchema));
});
