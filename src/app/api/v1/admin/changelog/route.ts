import { adminCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { adminChangelog, changelogSchema, createChangelog } from "@/server/services/content";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return { items: await adminChangelog() };
});

export const POST = route(async (ctx) => {
  const admin = await adminCaller(ctx);
  return { entry: await createChangelog(admin.user.id, await parseJson(ctx.req, changelogSchema)) };
}, { status: 201 });