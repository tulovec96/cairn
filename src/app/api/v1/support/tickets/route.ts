import { sessionCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { createTicket, listMyTickets, ticketSchema } from "@/server/services/support";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { items: await listMyTickets(actor) };
});

export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { ticket: await createTicket(actor, await parseJson(ctx.req, ticketSchema)) };
}, { status: 201 });