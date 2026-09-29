import { caller } from "@/server/api";
import { idParam, route, type Ctx } from "@/server/http";
import { previewKind } from "@/lib/fileTypes";
import { serveFile, serveSvgPreview } from "@/server/services/download";
import { fileCanBeServed } from "@/server/services/files";
import { getSharedFileRow } from "@/server/services/sharedFolders";

export const dynamic = "force-dynamic";

async function handle(ctx: Ctx<{ id: string }>) {
  const actor = await caller(ctx, "files:read");
  const file = await getSharedFileRow(actor, idParam.parse(ctx.params.id));
  fileCanBeServed(file);
  if (previewKind(file.mime, file.extension) === "svg") return serveSvgPreview(ctx.req, file);
  return serveFile(ctx.req, file, { mode: "preview" });
}

/** Same inert, safe-to-display rendition as the owner's preview. */
export const GET = route<{ id: string }>(handle);
export const HEAD = route<{ id: string }>(handle);
