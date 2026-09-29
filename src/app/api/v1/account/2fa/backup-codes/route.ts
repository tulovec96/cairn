import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { regenerateBackupCodes } from "@/server/services/auth";

export const dynamic = "force-dynamic";

/** Replaces all backup codes with 10 new ones (shown once). */
export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { password, code } = await parseJson(ctx.req, z.object({ password: z.string().min(1).max(200), code: z.string().trim().max(40).optional() }));
  return regenerateBackupCodes(actor, password, code, ctx.ip);
});