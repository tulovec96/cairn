import { sessionCaller } from "@/server/api";
import { route } from "@/server/http";
import { resendVerification } from "@/server/services/auth";

export const dynamic = "force-dynamic";

export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  await resendVerification(actor);
  return { ok: true };
});