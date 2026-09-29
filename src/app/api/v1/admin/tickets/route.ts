import { adminCaller } from "@/server/api";
import { parseQuery, route } from "@/server/http";
import { adminListTickets, adminTicketListSchema } from "@/server/services/support";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return adminListTickets(parseQuery(ctx.req, adminTicketListSchema));
});