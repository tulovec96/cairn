import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { beginTotpSetup, disableTotp, enableTotp } from "@/server/services/auth";

export const dynamic = "force-dynamic";

/** Step 1: creates a secret (and QR code) to add to an authenticator app. Nothing changes until step 2. */
export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return beginTotpSetup(actor);
});

/** Step 2: confirms with a code from the app, turns two-factor on and returns the one-time backup codes. */
export const PUT = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { code } = await parseJson(ctx.req, z.object({ code: z.string().trim().min(6).max(12) }));
  return enableTotp(actor, code, ctx.ip);
});

export const DELETE = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { password, code } = await parseJson(ctx.req, z.object({ password: z.string().min(1).max(200), code: z.string().trim().max(40).optional() }));
  await disableTotp(actor, password, code, ctx.ip);
  return { ok: true };
});