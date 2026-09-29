import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { changeEmail, emailSchema } from "@/server/services/auth";

export const dynamic = "force-dynamic";

const schema = z.object({ password: z.string().min(1).max(200), email: emailSchema });

export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { password, email } = await parseJson(ctx.req, schema);
  await changeEmail(actor, password, email, ctx.ip);
  return { ok: true };
});