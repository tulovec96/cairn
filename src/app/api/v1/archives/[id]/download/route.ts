import { Readable } from "node:stream";
import { caller } from "@/server/api";
import { Errors } from "@/server/errors";
import { idParam, route, type Ctx } from "@/server/http";
import { contentDisposition } from "@/server/security/filenames";
import { getArchive } from "@/server/services/archives";
import { parseRange } from "@/server/services/download";
import { storage } from "@/server/storage";

export const dynamic = "force-dynamic";

async function handle(ctx: Ctx<{ id: string }>) {
  const actor = await caller(ctx, "files:read");
  const job = await getArchive(actor, idParam.parse(ctx.params.id));
  if (job.status !== "ready" || !job.storageKey) throw Errors.conflict("This archive isn't ready yet.");
  if (job.expiresAt.getTime() <= Date.now()) throw Errors.gone("This archive has expired. Create a new one.");
  const stat = await storage().stat(job.storageKey);
  if (!stat) throw Errors.gone("This archive is no longer available.");
  const range = parseRange(ctx.req.headers.get("range"), stat.size);
  const headers = new Headers({
    "content-type": "application/zip",
    "content-disposition": contentDisposition("attachment", job.name),
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "content-length": String(range ? range.end - range.start + 1 : stat.size),
    "content-security-policy": "default-src 'none'; sandbox",
  });
  if (range) headers.set("content-range", `bytes ${range.start}-${range.end}/${stat.size}`);
  if (ctx.req.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  return new Response(Readable.toWeb(storage().createReadStream(job.storageKey, range ?? undefined)) as ReadableStream, { status: range ? 206 : 200, headers });
}

export const GET = route<{ id: string }>(handle);
export const HEAD = route<{ id: string }>(handle);
