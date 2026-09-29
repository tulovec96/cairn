import { z } from "zod";
import { adminCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { adminFlags, adminSetFlag } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

export const PUT = route<{ key: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  const { enabled } = await parseJson(ctx.req, z.object({ enabled: z.boolean() }));
  await adminSetFlag(admin.user.id, z.string().max(40).parse(ctx.params.key), enabled, ctx.ip);
  return { items: await adminFlags() };
});