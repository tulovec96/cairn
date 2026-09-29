import { adminCaller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { adminRetryJob } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (ctx) => {
  await adminCaller(ctx);
  await adminRetryJob(idParam.parse(ctx.params.id));
  return { ok: true };
});