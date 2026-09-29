import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { deleteReadNotifications, listNotifications, markNotificationsRead } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return listNotifications(actor.user.id);
});

const schema = z.object({ ids: z.array(idParam).max(100).optional() });

/** Marks notifications as read (all of them when `ids` is omitted). */
export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { ids } = await parseJson(ctx.req, schema);
  await markNotificationsRead(actor.user.id, ids);
  return listNotifications(actor.user.id);
});

export const DELETE = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  await deleteReadNotifications(actor.user.id);
  return listNotifications(actor.user.id);
});