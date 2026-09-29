import { adminCaller } from "@/server/api";
import { idParam, noContent, parseJson, route } from "@/server/http";
import { changelogSchema, deleteChangelog, updateChangelog } from "@/server/services/content";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  return { entry: await updateChangelog(admin.user.id, idParam.parse(ctx.params.id), await parseJson(ctx.req, changelogSchema.partial())) };
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  await deleteChangelog(admin.user.id, idParam.parse(ctx.params.id));
  return noContent();
});