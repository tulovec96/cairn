import { sessionCaller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { profileSchema, updateProfile } from "@/server/services/auth";
import { serializeUser } from "@/server/services/serializers";

export const dynamic = "force-dynamic";

export const PATCH = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const input = await parseJson(ctx.req, profileSchema);
  return { user: serializeUser(await updateProfile(actor, input)) };
});