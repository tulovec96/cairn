import { Readable } from "node:stream";
import type { File as FileRow } from "@prisma/client";
import { db } from "../db";
import { ApiError, Errors } from "../errors";
import { newId } from "../ids";
import { contentDisposition } from "../security/filenames";
import { sanitizeSvg } from "../security/svg";
import { storage } from "../storage";
import { emit } from "../events";
import { recordShareEvent } from "./shares";
import { thumbKey, type ThumbSize } from "./media";
import { addUsage, subjectOf } from "./usage";
import { previewKind } from "@/lib/fileTypes";

export interface ByteRangeResult {
  start: number;
  end: number;
}

/** Parses a single-range `Range` header. Returns null when absent/ignored, throws 416 when unsatisfiable. */
export function parseRange(header: string | null, size: number): ByteRangeResult | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null; // malformed or multi-range: ignore and serve the full body (RFC 9110 allows this)
  const [, s, e] = m;
  if (s === "" && e === "") return null;
  let start: number;
  let end: number;
  if (s === "") {
    const suffix = Number(e);
    if (suffix === 0) throw Errors.range(size);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === "" ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (!Number.isFinite(start) || start >= size || start > end) throw Errors.range(size);
  return { start, end };
}

const RISKY_DOWNLOAD_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript|text\/css|multipart\/|message\/)/i;

export type ServeMode = "download" | "preview";

export interface ServeOptions {
  mode: ServeMode;
  embed?: boolean;
  /** Called once before the first byte of a full/initial-range response is sent. May throw to refuse. */
  onStart?: () => Promise<void>;
  cacheControl?: string;
}

function baseHeaders(file: FileRow, opts: { contentType: string; disposition: "attachment" | "inline"; csp: string | null; embed?: boolean }): Headers {
  const h = new Headers();
  h.set("content-type", opts.contentType);
  h.set("content-disposition", contentDisposition(opts.disposition, file.originalName));
  h.set("x-content-type-options", "nosniff");
  h.set("accept-ranges", "bytes");
  h.set("referrer-policy", "no-referrer");
  // Embeds are an explicit, per-share opt-in: only then may other sites load or frame the resource.
  h.set("cross-origin-resource-policy", opts.embed ? "cross-origin" : "same-origin");
  if (!opts.embed) h.set("x-frame-options", "SAMEORIGIN");
  if (opts.csp) h.set("content-security-policy", opts.csp);
  h.set("etag", `"${file.sha256}"`);
  h.set("last-modified", file.createdAt.toUTCString());
  return h;
}

export function fileEtagMatches(req: Request, file: FileRow): boolean {
  const ifNone = req.headers.get("if-none-match");
  return !!ifNone && ifNone.split(",").some((t) => t.trim().replace(/^W\//, "") === `"${file.sha256}"`);
}

/** Streams a stored file honoring Range/HEAD, with content-type handling that can never execute uploaded content. */
export async function serveFile(req: Request, file: FileRow, opts: ServeOptions): Promise<Response> {
  const provider = storage();
  const stat = await provider.stat(file.storageKey);
  if (!stat) throw Errors.notFound("The file's data is missing from storage.");
  const size = stat.size;
  const kind = previewKind(file.mime, file.extension);

  let contentType: string;
  let disposition: "attachment" | "inline";
  let csp: string | null = "default-src 'none'; sandbox";
  if (opts.mode === "preview") {
    if (!kind) throw new ApiError(415, "bad_request", "This file type can't be previewed. Download it instead.");
    disposition = "inline";
    if (kind === "text") contentType = "text/plain; charset=utf-8";
    else if (kind === "svg") throw Errors.badRequest("SVG previews are served by the sanitizing endpoint.");
    else contentType = file.mime;
    if (kind === "pdf") csp = null; // the browser's PDF viewer does not run inside a CSP sandbox
    if (kind === "video" || kind === "audio") csp = "default-src 'none'; media-src 'self'; sandbox";
  } else {
    disposition = "attachment";
    contentType = RISKY_DOWNLOAD_TYPES.test(file.mime) ? "application/octet-stream" : file.mime;
  }

  const headers = baseHeaders(file, { contentType, disposition, csp, embed: opts.embed });
  headers.set("cache-control", opts.cacheControl ?? "private, no-store");

  const method = req.method.toUpperCase();
  let range: ByteRangeResult | null = null;
  const ifRange = req.headers.get("if-range");
  if (!ifRange || ifRange.replace(/^W\//, "") === `"${file.sha256}"`) range = parseRange(req.headers.get("range"), size);

  if (method === "GET" && fileEtagMatches(req, file) && !range && opts.mode === "preview") {
    return new Response(null, { status: 304, headers });
  }

  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("content-length", String(range.end - range.start + 1));
  } else {
    headers.set("content-length", String(size));
  }

  if (method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });

  // Count a download once per logical download: full requests and ranges that start at byte 0.
  if (opts.mode === "download" && opts.onStart && (!range || range.start === 0)) await opts.onStart();

  const nodeStream = provider.createReadStream(file.storageKey, range ?? undefined);
  const body = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(body, { status: range ? 206 : 200, headers });
}

/** Sanitized SVG preview. The result is served with a sandboxing CSP and is meant for <img> display. */
export async function serveSvgPreview(req: Request, file: FileRow, opts?: { embed?: boolean }): Promise<Response> {
  const maxBytes = 2 * 1024 * 1024;
  if (Number(file.size) > maxBytes) throw new ApiError(415, "bad_request", "This SVG is too large to preview. Download it instead.");
  const chunks: Buffer[] = [];
  for await (const c of storage().createReadStream(file.storageKey)) chunks.push(c as Buffer);
  const clean = sanitizeSvg(Buffer.concat(chunks).toString("utf8"));
  const headers = baseHeaders(file, { contentType: "image/svg+xml; charset=utf-8", disposition: "inline", csp: "default-src 'none'; style-src 'unsafe-inline'; sandbox", embed: opts?.embed });
  headers.delete("etag");
  headers.set("cache-control", "private, no-store");
  headers.set("content-length", String(Buffer.byteLength(clean)));
  return new Response(req.method.toUpperCase() === "HEAD" ? null : clean, { status: 200, headers });
}

export async function serveThumbnail(req: Request, file: FileRow, size: ThumbSize = "m"): Promise<Response> {
  if (!file.thumbnailKey) throw Errors.notFound("No thumbnail.");
  let key = thumbKey(file.thumbnailKey, size);
  let stat = await storage().stat(key);
  if (!stat) {
    // Thumbnails generated before multiple sizes existed live under the bare key.
    key = file.thumbnailKey;
    stat = await storage().stat(key);
  }
  if (!stat) throw Errors.notFound("No thumbnail.");
  const headers = new Headers({
    "content-type": "image/webp",
    "content-length": String(stat.size),
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=3600",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
  });
  if (req.method.toUpperCase() === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(Readable.toWeb(storage().createReadStream(key)) as ReadableStream, { status: 200, headers });
}

export async function recordDownload(fileId: string, shareId?: string | null, bytes?: number, actorLabel?: string): Promise<void> {
  const file = await db.file.update({ where: { id: fileId }, data: { downloadCount: { increment: 1 }, lastDownloadAt: new Date(), lastAccessedAt: new Date() }, select: { ownerId: true, orgId: true, originalName: true, size: true } });
  await db.download.create({ data: { id: newId("dwn"), fileId, shareId: shareId ?? null, bytes: BigInt(bytes ?? Number(file.size)) } });
  await addUsage(subjectOf({ userId: file.ownerId, orgId: file.orgId }), "downloadBytes", bytes ?? Number(file.size));
  if (shareId) await recordShareEvent(shareId, "download", { bytes: bytes ?? Number(file.size) }).catch(() => undefined);
  await emit({ type: "file.downloaded", workspaceId: file.orgId ?? file.ownerId, ownerId: file.ownerId, orgId: file.orgId, actorLabel: actorLabel ?? (shareId ? "Share link visitor" : "Owner"), fileId, targetName: file.originalName, data: { bytes: bytes ?? Number(file.size), viaShare: !!shareId } });
}
