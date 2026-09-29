import { adminCaller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { adminFileAction, adminFileActionSchema, getAdminFile } from "@/server/services/admin";

export const dynamic = "force-dynamic";

/** Metadata only. Administrators can inspect a file's record and scan history but not read its contents. */
export const GET = route<{ id: string }>(async (ctx) => {
  await adminCaller(ctx);
  return getAdminFile(idParam.parse(ctx.params.id));
});

/** quarantine | release | delete | rescan */
export const POST = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  const input = await parseJson(ctx.req, adminFileActionSchema);
  return adminFileAction(admin, idParam.parse(ctx.params.id), input, ctx.ip);
});
