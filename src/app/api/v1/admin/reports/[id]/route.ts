import { adminCaller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { resolveReport, resolveReportSchema } from "@/server/services/reports";

export const dynamic = "force-dynamic";

/** Review workflow: mark as reviewing, or resolve as actioned/dismissed, optionally quarantining or deleting the file. */
export const POST = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  const input = await parseJson(ctx.req, resolveReportSchema);
  await resolveReport(admin.user.id, idParam.parse(ctx.params.id), input, ctx.ip);
  return { ok: true };
});
