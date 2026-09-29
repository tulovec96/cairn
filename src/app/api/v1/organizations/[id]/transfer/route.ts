import { z } from "zod";
import { sessionCaller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { transferOwnership } from "@/server/services/organizations";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const { userId } = await parseJson(ctx.req, z.object({ userId: idParam }));
  await transferOwnership(actor, idParam.parse(ctx.params.id), userId, ctx.ip);
  return { ok: true };
});