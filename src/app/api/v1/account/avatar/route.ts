import { sessionCaller } from "@/server/api";
import { readBodyLimited, route } from "@/server/http";
import { removeAvatar, setAvatar } from "@/server/services/auth";
import { serializeUser } from "@/server/services/serializers";

export const dynamic = "force-dynamic";

/** Raw image body (JPEG, PNG, WebP, GIF or AVIF, up to 5 MB). It is re-encoded as a 256px WebP. */
export const PUT = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const bytes = await readBodyLimited(ctx.req, 5 * 1024 * 1024);
  return { user: serializeUser(await setAvatar(actor, bytes)) };
});

export const DELETE = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { user: serializeUser(await removeAvatar(actor)) };
});