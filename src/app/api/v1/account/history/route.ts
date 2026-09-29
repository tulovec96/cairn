import { sessionCaller } from "@/server/api";
import { route } from "@/server/http";
import { backupCodesRemaining, loginHistory } from "@/server/services/auth";

export const dynamic = "force-dynamic";

/** Sign-ins and security changes on this account, newest first. */
export const GET = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { items: await loginHistory(actor.user.id), backupCodesRemaining: actor.user.totpEnabledAt ? await backupCodesRemaining(actor.user.id) : 0 };
});