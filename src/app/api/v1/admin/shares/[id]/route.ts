import { adminCaller } from "@/server/api";
import { idParam, noContent, route } from "@/server/http";
import { adminRevokeShare } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

/** Revokes a link (moderation). The record stays for the audit trail. */
export const DELETE = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  await adminRevokeShare(admin.user.id, idParam.parse(ctx.params.id), ctx.ip);
  return noContent();
});