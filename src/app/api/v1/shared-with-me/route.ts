import { caller } from "@/server/api";
import { route } from "@/server/http";
import { listSharedWithMe } from "@/server/services/sharedFolders";

export const dynamic = "force-dynamic";

/** Folders other people have shared with you. */
export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return { items: await listSharedWithMe(actor) };
});
