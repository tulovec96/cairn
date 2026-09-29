import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { changePassword } from "@/server/services/auth";

export const dynamic = "force-dynamic";

const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { currentPassword, newPassword } = await parseJson(ctx.req, schema);
  await changePassword(actor, currentPassword, newPassword, ctx.ip);
  return { ok: true };
});