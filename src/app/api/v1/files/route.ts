import { Readable } from "node:stream";
import Busboy from "busboy";
import { z } from "zod";
import { caller, hex64, isoDateTime, nullableId } from "@/server/api";
import { ApiError, Errors } from "@/server/errors";
import { parseQuery, route } from "@/server/http";
import type { Actor } from "@/server/services/actor";
import { listFiles } from "@/server/services/files";
import { limitsFor } from "@/server/services/limits";
import { directUpload, enforceUploadInitLimits, type DirectUploadInput } from "@/server/services/uploads";
import { formatBytes } from "@/lib/format";
import type { FileCategory } from "@/lib/fileTypes";
import type { UploadSessionDto } from "@/lib/types";

export const dynamic = "force-dynamic";

const CATEGORIES = ["image", "video", "audio", "document", "archive", "code", "other"] as const;

const listSchema = z.object({
  view: z.enum(["all", "recent", "favorites", "shared", "archived"]).default("all"),
  folderId: nullableId.optional(),
  q: z.string().trim().max(300).optional(),
  type: z.enum(CATEGORIES).optional(),
  sort: z.enum(["name", "size", "created", "modified", "downloads", "type"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  by: z.enum(["uploaded", "modified", "accessed", "shared"]).optional(),
  scope: z.enum(["folder", "everywhere"]).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Lists files (and folders) with search operators, filtering, sorting and cursor pagination. */
export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  const q = parseQuery(ctx.req, listSchema);
  return listFiles(actor, { ...q, folderId: q.folderId ?? null, type: q.type as FileCategory | undefined });
});

const optionsSchema = z.object({
  folderId: nullableId.optional(),
  share: z.enum(["true", "false"]).optional(),
  expiresAt: z.union([isoDateTime, z.literal("never")]).optional(),
  password: z.string().min(4).max(128).optional(),
  maxDownloads: z.coerce.number().int().min(1).max(1_000_000).optional(),
  sha256: hex64.optional(),
  replaceFileId: z.string().max(40).optional(),
});

function toInput(fields: Record<string, string>): Omit<DirectUploadInput, "stream" | "fileName"> {
  const parsed = optionsSchema.safeParse(fields);
  if (!parsed.success) throw Errors.validation("Some upload options are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const p = parsed.data;
  return {
    folderId: p.folderId ?? null,
    share: p.share === undefined ? undefined : p.share === "true",
    expiresAt: p.expiresAt === undefined ? undefined : p.expiresAt === "never" ? null : p.expiresAt,
    password: p.password ?? null,
    maxDownloads: p.maxDownloads ?? null,
    sha256: p.sha256 ?? null,
    replaceFileId: p.replaceFileId ?? null,
  };
}

function multipartUpload(actor: Actor, req: Request): Promise<UploadSessionDto> {
  return new Promise((resolve, reject) => {
    if (!req.body) return reject(Errors.badRequest("The request body is empty."));
    const bb = Busboy({ headers: Object.fromEntries(req.headers.entries()), limits: { files: 1, fields: 20, fieldSize: 4096 } });
    const fields: Record<string, string> = {};
    let started = false;
    bb.on("field", (name, value) => {
      fields[name] = value;
    });
    bb.on("file", (_name, stream, info) => {
      started = true;
      try {
        const options = toInput(fields);
        directUpload(actor, { ...options, stream, fileName: info.filename || "file" }).then(resolve, reject);
      } catch (err) {
        stream.resume();
        reject(err);
      }
    });
    bb.on("error", (err) => reject(Errors.badRequest(`Invalid multipart body: ${(err as Error).message}`)));
    bb.on("close", () => {
      if (!started) reject(Errors.badRequest('No file was found. Send it as a multipart field named "file".'));
    });
    Readable.fromWeb(req.body as never).pipe(bb);
  });
}

/**
 * One-shot upload for scripts: `curl -F file=@photo.jpg /api/v1/files`, or a raw body with `?name=photo.jpg`.
 * Options (folderId, expiresAt, password, maxDownloads, share, sha256, replaceFileId) go in form fields (before the file) or the query string.
 * Uploading always needs an account session or an API key.
 */
export const POST = route(async (ctx) => {
  const actor = await caller(ctx, "files:upload");
  await enforceUploadInitLimits(actor);
  const limits = await limitsFor(actor);
  const declared = Number(ctx.req.headers.get("content-length") ?? "0");
  if (limits.maxFileBytes >= 0 && declared > limits.maxFileBytes + 1024 * 1024) throw Errors.fileTooLarge(formatBytes(limits.maxFileBytes));

  const contentType = ctx.req.headers.get("content-type") ?? "";
  let upload: UploadSessionDto;
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    upload = await multipartUpload(actor, ctx.req);
  } else {
    const url = new URL(ctx.req.url);
    const name = url.searchParams.get("name") ?? ctx.req.headers.get("x-filename");
    if (!name) throw new ApiError(400, "bad_request", "Provide the file name via ?name= (or an X-Filename header) for raw uploads.");
    if (!ctx.req.body) throw Errors.badRequest("The request body is empty.");
    const fields: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      if (k !== "name") fields[k] = v;
    });
    upload = await directUpload(actor, { ...toInput(fields), stream: Readable.fromWeb(ctx.req.body as never), fileName: name });
  }
  if (upload.status !== "complete" || !upload.file) {
    const checksum = /checksum/i.test(upload.error ?? "");
    throw checksum ? Errors.checksum(upload.error ?? undefined) : new ApiError(422, "validation_error", upload.error ?? "The upload could not be saved.");
  }
  return { file: upload.file, shareUrl: upload.shareUrl };
}, { status: 201 });
