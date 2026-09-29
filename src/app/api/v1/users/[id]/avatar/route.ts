import { Readable } from "node:stream";
import { optionalCaller } from "@/server/api";
import { db } from "@/server/db";
import { Errors } from "@/server/errors";
import { idParam, route } from "@/server/http";
import { storage } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Avatars are visible to their owner and to people who share an organization with them. */
export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await optionalCaller(ctx);
  if (!actor) throw Errors.unauthorized();
  const id = idParam.parse(ctx.params.id);
  const user = await db.user.findUnique({ where: { id }, select: { avatarKey: true } });
  if (!user?.avatarKey) throw Errors.notFound();
  if (id !== actor.user.id) {
    const shared = await db.organizationMember.findFirst({ where: { userId: id, org: { members: { some: { userId: actor.user.id } } } }, select: { id: true } });
    if (!shared) throw Errors.notFound();
  }
  const stat = await storage().stat(user.avatarKey);
  if (!stat) throw Errors.notFound();
  return new Response(Readable.toWeb(storage().createReadStream(user.avatarKey)) as ReadableStream, {
    headers: { "content-type": "image/webp", "content-length": String(stat.size), "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600", "cross-origin-resource-policy": "same-origin" },
  });
});