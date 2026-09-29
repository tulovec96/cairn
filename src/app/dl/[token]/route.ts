import { z } from "zod";
import { Errors } from "@/server/errors";
import { route, type Ctx } from "@/server/http";
import * as rate from "@/server/ratelimit";
import { getSettings } from "@/server/settings";
import { previewKind } from "@/lib/fileTypes";
import { contentDisposition } from "@/server/security/filenames";
import { zipResponse } from "@/server/services/archives";
import { recordDownload, serveFile, serveSvgPreview, serveThumbnail } from "@/server/services/download";
import { fileCanBeServed } from "@/server/services/files";
import { collectFolderFiles } from "@/server/services/folders";
import { assertFileInSharedFolder } from "@/server/services/publicShares";
import { assertShareUnlocked, canDownload, consumeShareDownload, resolveShare } from "@/server/services/shares";
import { assertTransferAvailable } from "@/server/services/usage";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  f: z.string().max(40).regex(/^[A-Za-z0-9_]+$/).optional(),
  mode: z.enum(["download", "preview", "thumb", "zip"]).optional(),
  embed: z.enum(["1"]).optional(),
});

async function handle(ctx: Ctx<{ token: string }>) {
  const settings = await getSettings();
  if (settings.maintenance.enabled && !settings.maintenance.allowDownloads) throw Errors.maintenance(settings.maintenance.message);
  rate.enforce([`dl-ip:${ctx.ip}`, `dl-share:${ctx.params.token}`], settings.rateLimits.download);

  const query = querySchema.safeParse(Object.fromEntries(new URL(ctx.req.url).searchParams));
  if (!query.success) throw Errors.badRequest("Invalid download parameters.");
  const { share, file, folder } = await resolveShare(ctx.params.token, { ip: ctx.ip });
  assertShareUnlocked(ctx.req, share);
  const embed = query.data.embed === "1" && share.embedEnabled;
  const mode = query.data.mode ?? "download";
  const wantsBytes = mode === "download" || mode === "zip";
  // "View only" links never hand out the original bytes: previews and thumbnails still work.
  if (wantsBytes && !canDownload(share)) throw Errors.forbidden("Downloading is turned off for this link.");
  const scope = { userId: (file ?? folder)!.ownerId, orgId: (file ?? folder)!.orgId };

  // Folder shares: no file selected (or mode=zip) means "everything, as a ZIP".
  if (folder && (mode === "zip" || !query.data.f)) {
    if (!canDownload(share)) throw Errors.forbidden("Downloading is turned off for this link.");
    const entries = await collectFolderFiles(scope, [folder.id], { onlyAvailable: true });
    if (!entries.length) throw Errors.notFound("There are no downloadable files in this folder.");
    const total = entries.reduce((n, e) => n + Number(e.file.size), 0);
    if (total > settings.files.archiveMaxBytes) throw Errors.tooLarge("This folder is too large to download as a single archive. Download the files individually.");
    await assertTransferAvailable(scope, total);
    const headers = new Headers({
      "content-type": "application/zip",
      "content-disposition": contentDisposition("attachment", `${folder.name}.zip`),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; sandbox",
    });
    if (ctx.req.method === "HEAD") return new Response(null, { status: 200, headers });
    if (!(await consumeShareDownload(share))) throw Errors.gone("This link has reached its download limit.");
    return zipResponse(entries, headers, { shareId: share.id });
  }

  const target = file ?? (await assertFileInSharedFolder(folder!, query.data.f!));
  fileCanBeServed(target);

  if (mode === "thumb") return serveThumbnail(ctx.req, target);
  if (mode === "preview") {
    if (previewKind(target.mime, target.extension) === "svg") return serveSvgPreview(ctx.req, target, { embed });
    return serveFile(ctx.req, target, { mode: "preview", cacheControl: "private, no-store", embed });
  }
  await assertTransferAvailable(scope, Number(target.size));
  return serveFile(ctx.req, target, {
    mode: "download",
    onStart: async () => {
      if (!(await consumeShareDownload(share))) throw Errors.gone("This link has reached its download limit.");
      await recordDownload(target.id, share.id);
    },
  });
}

/** Public file delivery for share links: Range-capable streaming, inline previews, thumbnails and folder ZIPs. */
export const GET = route<{ token: string }>(handle);
export const HEAD = route<{ token: string }>(handle);
