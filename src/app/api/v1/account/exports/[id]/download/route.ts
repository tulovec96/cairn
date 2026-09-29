import { Readable } from "node:stream";
import { sessionCaller } from "@/server/api";
import { Errors } from "@/server/errors";
import { idParam, route } from "@/server/http";
import { contentDisposition } from "@/server/security/filenames";
import { getExportForDownload } from "@/server/services/transfer";
import { storage } from "@/server/storage";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await sessionCaller(ctx);
  const row = await getExportForDownload(actor, idParam.parse(ctx.params.id));
  const stat = await storage().stat(row.storageKey!);
  if (!stat) throw Errors.gone("This export is no longer available.");
  return new Response(Readable.toWeb(storage().createReadStream(row.storageKey!)) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(stat.size),
      "content-disposition": contentDisposition("attachment", `cairn-export-${row.createdAt.toISOString().slice(0, 10)}.zip`),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});