import { z } from "zod";
import { caller } from "@/server/api";
import { idParam, noContent, parseJson, route } from "@/server/http";
import { shareOptionsSchema } from "@/server/schemas";
import { deleteShare, revokeShare, updateShare } from "@/server/services/shares";

export const dynamic = "force-dynamic";

const patchSchema = shareOptionsSchema.extend({ revoked: z.literal(true).optional() });

/** Change a link's options (password, expiry, limits, permissions, branding) — or revoke it with { "revoked": true }. */
export const PATCH = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "shares:write");
  const id = idParam.parse(ctx.params.id);
  const { revoked, ...patch } = await parseJson(ctx.req, patchSchema);
  if (revoked) return { share: await revokeShare(actor, id, ctx.ip) };
  return { share: await updateShare(actor, id, patch, ctx.ip) };
});

/** Permanently removes the link record (revoked or not). */
export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "shares:write");
  await deleteShare(actor, idParam.parse(ctx.params.id), ctx.ip);
  return noContent();
});
