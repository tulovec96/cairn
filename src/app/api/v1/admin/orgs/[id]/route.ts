import { adminCaller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { adminGetOrg } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  await adminCaller(ctx);
  return adminGetOrg(idParam.parse(ctx.params.id));
});