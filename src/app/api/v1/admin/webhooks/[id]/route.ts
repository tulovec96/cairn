import { z } from "zod";
import { adminCaller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { adminSetWebhookEnabled } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  const { enabled } = await parseJson(ctx.req, z.object({ enabled: z.boolean() }));
  await adminSetWebhookEnabled(admin.user.id, idParam.parse(ctx.params.id), enabled);
  return { ok: true };
});