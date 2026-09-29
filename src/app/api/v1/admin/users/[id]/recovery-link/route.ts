import { adminCaller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { issueRecoveryLink } from "@/server/services/auth";

export const dynamic = "force-dynamic";

/** One-time link (valid 24 hours) to hand to a locked-out user. It sets a new password, so treat it like a password. */
export const POST = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  return { link: await issueRecoveryLink(admin.user.id, idParam.parse(ctx.params.id)) };
});