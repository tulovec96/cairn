import { sessionCaller } from "@/server/api";
import { idParam, noContent, parseJson, route } from "@/server/http";
import { closeMyTicket, getMyTicket, replySchema, replyToMyTicket } from "@/server/services/support";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return getMyTicket(actor, idParam.parse(ctx.params.id));
});

export const POST = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { body } = await parseJson(ctx.req, replySchema);
  return replyToMyTicket(actor, idParam.parse(ctx.params.id), body);
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  await closeMyTicket(actor, idParam.parse(ctx.params.id));
  return noContent();
});