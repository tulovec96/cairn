import { caller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { listVersions } from "@/server/services/versions";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return { items: await listVersions(actor, idParam.parse(ctx.params.id)) };
});