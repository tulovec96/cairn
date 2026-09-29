import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { parseJson, route, SESSION_COOKIE } from "@/server/http";
import { deleteAccount } from "@/server/services/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  password: z.string().min(1).max(200),
  code: z.string().trim().max(40).optional(),
  confirm: z.literal("DELETE", { message: 'Type "DELETE" to confirm.' }),
});

/** Permanently deletes the caller's account, files, folders, shares, API keys and sessions. Needs the password (and the 2FA code, if enabled). */
export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { password, code } = await parseJson(ctx.req, schema);
  await deleteAccount(actor, password, code, ctx.ip);
  ctx.clearCookie(SESSION_COOKIE);
  return { ok: true };
});