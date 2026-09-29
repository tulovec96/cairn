import { caller } from "@/server/api";
import { idParam, route, type Ctx } from "@/server/http";
import { previewKind } from "@/lib/fileTypes";
import { serveFile, serveSvgPreview } from "@/server/services/download";
import { fileCanBeServed, getFileRow, touchAccessed } from "@/server/services/files";

export const dynamic = "force-dynamic";

async function handle(ctx: Ctx<{ id: string }>) {
  const actor = await caller(ctx, "files:read");
  const file = await getFileRow(actor, idParam.parse(ctx.params.id));
  fileCanBeServed(file);
  if (ctx.req.method === "GET") void touchAccessed(file.id);
  if (previewKind(file.mime, file.extension) === "svg") return serveSvgPreview(ctx.req, file);
  return serveFile(ctx.req, file, { mode: "preview" });
}

/** Inline, safe-to-display rendition: images, media and PDFs as-is, SVG sanitized, text as text/plain. Never HTML. */
export const GET = route<{ id: string }>(handle);
export const HEAD = route<{ id: string }>(handle);
