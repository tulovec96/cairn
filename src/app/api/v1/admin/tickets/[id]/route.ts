import { z } from "zod";
import { adminCaller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { adminGetTicket, adminReply, adminReplySchema, adminSetTicketStatus } from "@/server/services/support";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  await adminCaller(ctx);
  return adminGetTicket(idParam.parse(ctx.params.id));
});

export const POST = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  return adminReply(admin.user.id, idParam.parse(ctx.params.id), await parseJson(ctx.req, adminReplySchema));
});

export const PATCH = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  const { status } = await parseJson(ctx.req, z.object({ status: z.enum(["open", "answered", "closed"]) }));
  await adminSetTicketStatus(admin.user.id, idParam.parse(ctx.params.id), status);
  return { ok: true };
});