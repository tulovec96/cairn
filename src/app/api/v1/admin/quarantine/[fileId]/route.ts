import { adminCaller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { adminQuarantineAction, quarantineActionSchema } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

/** Review a quarantined file: release it, confirm it as malicious, or delete it. */
export const POST = route<{ fileId: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  await adminQuarantineAction(admin.user.id, idParam.parse(ctx.params.fileId), await parseJson(ctx.req, quarantineActionSchema), ctx.ip);
  return { ok: true };
});