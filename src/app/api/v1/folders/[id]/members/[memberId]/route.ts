import { caller } from "@/server/api";
import { idParam, noContent, route } from "@/server/http";
import { removeFolderMember } from "@/server/services/sharedFolders";

export const dynamic = "force-dynamic";

/** The owner removes someone, or a member removes their own access (their membership id). */
export const DELETE = route<{ id: string; memberId: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  await removeFolderMember(actor, idParam.parse(ctx.params.id), idParam.parse(ctx.params.memberId), ctx.ip);
  return noContent();
});
