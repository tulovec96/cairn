import { caller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { browseSharedFolder } from "@/server/services/sharedFolders";

export const dynamic = "force-dynamic";

/** Contents of a shared folder (or any subfolder of it): subfolders, files and the path back to the shared root. */
export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return browseSharedFolder(actor, idParam.parse(ctx.params.id));
});
