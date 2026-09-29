import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Upload } from "@prisma/client";
import { db } from "../db";
import { hashPassword, hashToken } from "../crypto";
import { Errors } from "../errors";
import { emit } from "../events";
import { newId, newSecretToken, newShareToken, newStorageKey } from "../ids";
import { enqueueJob } from "../jobs/queue";
import * as rate from "../ratelimit";
import { detectType } from "../security/mime";
import { safeExtension, sanitizeFilename, uniqueName } from "../security/filenames";
import { getSettings } from "../settings";
import { stagingPath, storage } from "../storage";
import { thumbKeysOf } from "../storage/keys";
import { formatBytes } from "@/lib/format";
import type { UploadSessionDto } from "@/lib/types";
import { scopeOf, workspaceIdOf, type Actor, type Scope } from "./actor";
import { audit } from "./audit";
import { ensureDataDirsOnce } from "./bootstrap";
import { assertFeature, assertLimit, entitlementsForActor, entitlementsForScope } from "./limits";
import { getOwnedFolder } from "./folders";
import { assertUploadAllowed, checkExtension, checkQuotaWarning, limitsFromEntitlements, resolveExpiry } from "./limits";
import { assertCan } from "./permissions";
import { notify } from "./notifications";
import { serializeFile } from "./serializers";
import { fileInclude } from "./files";
import { addUsage, subjectOf } from "./usage";
import { archiveCurrentAsVersion, pruneVersions } from "./versions";

export interface InitUploadInput {
  fileName: string;
  size: number;
  mime?: string;
  folderId?: string | null;
  share?: boolean;
  /** undefined / null = keep forever, Date = delete at that time */
  expiresAt?: Date | null;
  password?: string | null;
  maxDownloads?: number | null;
  sha256?: string | null;
  /** Upload the content as a new version of this file. */
  replaceFileId?: string | null;
}

/** Who is talking to an upload session: its owner, or an outside contributor holding the per-upload key. */
export type UploadAuth = { actor: Actor } | { uploadKey: string };

const NOTIFY_MIN_BYTES = 100 * 1024 ** 2;
const chunkLocks = new Set<string>();

function limiterKey(auth: UploadAuth, uploadId?: string): string {
  return "actor" in auth ? auth.actor.user.id : `up:${uploadId ?? hashToken(auth.uploadKey).slice(0, 12)}`;
}

export async function enforceUploadInitLimits(actor: Actor) {
  const settings = await getSettings();
  rate.enforce(`upload-init:${actor.user.id}`, settings.rateLimits.upload);
}

/** Options that only some plans include are enforced here, not just hidden in the UI. */
async function assertShareOptionsAllowed(actor: Actor, input: Pick<InitUploadInput, "maxDownloads">) {
  const ent = await entitlementsForActor(actor);
  if (input.maxDownloads) await assertFeature(ent, "shareLimits");
}

export async function initUpload(actor: Actor, input: InitUploadInput): Promise<UploadSessionDto> {
  assertCan(actor, "write");
  await ensureDataDirsOnce();
  const settings = await getSettings();
  const scope = scopeOf(actor);
  const ent = await entitlementsForActor(actor);
  const fileName = sanitizeFilename(input.fileName);
  const ext = safeExtension(fileName);

  if (input.replaceFileId) {
    await assertFeature(ent, "fileVersioning");
    const target = await db.file.findFirst({ where: { id: input.replaceFileId, ...(scope.orgId ? { orgId: scope.orgId } : { ownerId: scope.userId, orgId: null }), deletedAt: null } });
    if (!target) throw Errors.notFound("The file you're replacing doesn't exist.");
    if (target.status !== "available") throw Errors.conflict("That file is still being processed.");
  }
  await assertUploadAllowed(scope, ent, { size: input.size, ext });
  await assertShareOptionsAllowed(actor, input);
  if (input.folderId) await getOwnedFolder(scope, input.folderId);

  const expiresAt = resolveExpiry(limitsFromEntitlements(ent), input.expiresAt);
  const chunkSize = settings.uploads.chunkSizeBytes;
  const totalChunks = Math.ceil(input.size / chunkSize);
  const id = newId("upl");
  const path = stagingPath(id);
  await fsp.writeFile(path, "");

  const upload = await db.upload.create({
    data: {
      id,
      ownerId: actor.user.id,
      orgId: scope.orgId,
      folderId: input.folderId ?? null,
      replaceFileId: input.replaceFileId ?? null,
      fileName,
      declaredMime: input.mime?.slice(0, 200) ?? null,
      size: BigInt(input.size),
      chunkSize,
      totalChunks,
      stagingPath: path,
      expectedSha256: input.sha256?.toLowerCase() ?? null,
      share: !!input.share && !input.replaceFileId,
      expiresAt,
      sharePasswordHash: input.password ? await hashPassword(input.password) : null,
      maxDownloads: input.maxDownloads ?? null,
      sessionExpiresAt: new Date(Date.now() + settings.uploads.sessionTtlHours * 3600_000),
    },
  });
  return toDto(upload, [], null);
}

// ---------------------------------------------------------------------------------------------
// File requests: uploads from people without an account, through a controlled endpoint
// ---------------------------------------------------------------------------------------------

export interface RequestUploadInput {
  fileName: string;
  size: number;
  uploaderLabel?: string | null;
}

export async function initRequestUpload(requestId: string, input: RequestUploadInput, ip: string): Promise<UploadSessionDto> {
  await ensureDataDirsOnce();
  const settings = await getSettings();
  rate.enforce([`request-upload-ip:${ip}`, `request-upload:${requestId}`], settings.rateLimits.requestUpload);
  const request = await db.fileRequest.findUnique({ where: { id: requestId }, include: { owner: true } });
  if (!request || request.closedAt) throw Errors.gone("This upload page is closed.");
  if (request.expiresAt && request.expiresAt.getTime() <= Date.now()) throw Errors.gone("This upload page has expired.");
  if (request.owner.status !== "active") throw Errors.gone();

  const fileName = sanitizeFilename(input.fileName);
  const ext = safeExtension(fileName);
  const allowed = JSON.parse(request.allowedExtensions || "[]") as string[];
  if (allowed.length && !allowed.includes(ext)) throw Errors.blockedType(ext || "unknown");
  if (request.maxFileBytes != null && input.size > Number(request.maxFileBytes)) throw Errors.fileTooLarge(formatBytes(Number(request.maxFileBytes)));
  if (request.maxFiles != null && request.uploadCount >= request.maxFiles) throw Errors.gone("This upload page has received the maximum number of files.");
  if (request.maxTotalBytes != null && Number(request.totalBytes) + input.size > Number(request.maxTotalBytes)) throw Errors.quota("This upload page has reached its size limit.");

  const scope: Scope = { userId: request.ownerId, orgId: request.orgId };
  const ent = await entitlementsForScope(scope, request.owner);
  await assertUploadAllowed(scope, ent, { size: input.size, ext }, { maxActive: 200 });

  const chunkSize = settings.uploads.chunkSizeBytes;
  const id = newId("upl");
  const key = newSecretToken(24);
  const path = stagingPath(id);
  await fsp.writeFile(path, "");
  const upload = await db.upload.create({
    data: {
      id,
      ownerId: request.ownerId,
      orgId: request.orgId,
      folderId: request.folderId,
      requestId: request.id,
      uploadKeyHash: hashToken(key),
      uploaderLabel: input.uploaderLabel?.trim().slice(0, 80) || null,
      fileName,
      size: BigInt(input.size),
      chunkSize,
      totalChunks: Math.ceil(input.size / chunkSize),
      stagingPath: path,
      sessionExpiresAt: new Date(Date.now() + 6 * 3600_000),
    },
  });
  return { ...(await toDto(upload, [], null)), uploadKey: key };
}

async function authorize(auth: UploadAuth, id: string): Promise<Upload> {
  const upload =
    "actor" in auth
      ? await db.upload.findFirst({ where: { id, ownerId: auth.actor.user.id, orgId: auth.actor.workspace.orgId } })
      : await db.upload.findFirst({ where: { id, uploadKeyHash: hashToken(auth.uploadKey), requestId: { not: null } } });
  if (!upload) throw Errors.notFound("That upload session doesn't exist or has expired.");
  return upload;
}

async function toDto(upload: Upload, received: number[], file: UploadSessionDto["file"], extra?: Partial<UploadSessionDto>): Promise<UploadSessionDto> {
  return {
    id: upload.id,
    fileName: upload.fileName,
    size: Number(upload.size),
    chunkSize: upload.chunkSize,
    totalChunks: upload.totalChunks,
    received,
    status: upload.status as UploadSessionDto["status"],
    expiresAt: upload.sessionExpiresAt.toISOString(),
    file,
    shareUrl: file?.share?.url ?? null,
    error: upload.error,
    ...extra,
  };
}

export async function getUploadSession(auth: UploadAuth, id: string): Promise<UploadSessionDto> {
  const upload = await authorize(auth, id);
  const chunks = await db.uploadChunk.findMany({ where: { uploadId: id }, select: { index: true }, orderBy: { index: "asc" } });
  let file: UploadSessionDto["file"] = null;
  if (upload.status === "complete" && upload.fileId && "actor" in auth) {
    const row = await db.file.findFirst({ where: { id: upload.fileId }, include: fileInclude(auth.actor) });
    if (row) file = serializeFile(row);
  }
  return toDto(upload, chunks.map((c) => c.index), file);
}

function expectedChunkSize(upload: Upload, index: number): number {
  const size = Number(upload.size);
  return index === upload.totalChunks - 1 ? size - index * upload.chunkSize : upload.chunkSize;
}

/**
 * Streams one chunk to its offset in the staging file. The server hashes what it actually wrote;
 * a client-supplied checksum is only ever compared against that, never trusted.
 */
export async function receiveChunk(auth: UploadAuth, uploadId: string, index: number, req: Request): Promise<{ index: number; sha256: string; received: number }> {
  const settings = await getSettings();
  rate.enforce(`chunk:${limiterKey(auth, uploadId)}`, settings.rateLimits.chunk);
  const upload = await authorize(auth, uploadId);
  if (upload.status !== "active") throw Errors.uploadClosed();
  if (upload.sessionExpiresAt.getTime() <= Date.now()) throw Errors.gone("This upload session has expired. Start the upload again.");
  if (!Number.isInteger(index) || index < 0 || index >= upload.totalChunks) throw Errors.validation("Chunk index out of range.");

  const expected = expectedChunkSize(upload, index);
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) !== expected) {
    throw Errors.badRequest(`Chunk ${index} must be exactly ${expected} bytes (received Content-Length ${declared}).`);
  }
  if (!req.body) throw Errors.badRequest("The chunk body is empty.");

  const lockKey = `${uploadId}:${index}`;
  if (chunkLocks.has(lockKey)) throw Errors.conflict("This chunk is already being uploaded.");
  chunkLocks.add(lockKey);
  try {
    const hash = createHash("sha256");
    let written = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        if (written > expected) return cb(Errors.badRequest(`Chunk ${index} is larger than expected.`));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    const out = fs.createWriteStream(upload.stagingPath, { flags: "r+", start: index * upload.chunkSize });
    try {
      await pipeline(Readable.fromWeb(req.body as never), meter, out);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw Errors.gone("This upload session is no longer available.");
      throw err;
    }
    if (written !== expected) throw Errors.badRequest(`Chunk ${index} was truncated (${written} of ${expected} bytes).`);
    const sha256 = hash.digest("hex");
    const claimed = req.headers.get("x-chunk-sha256")?.trim().toLowerCase();
    if (claimed && claimed !== sha256) throw Errors.checksum(`Chunk ${index} was corrupted in transit. Retry the chunk.`);

    await db.uploadChunk.upsert({
      where: { uploadId_index: { uploadId, index } },
      create: { id: newId("chk"), uploadId, index, size: expected, sha256 },
      update: { size: expected, sha256 },
    });
    await db.upload.update({ where: { id: uploadId }, data: { sessionExpiresAt: new Date(Date.now() + (upload.requestId ? 6 : settings.uploads.sessionTtlHours) * 3600_000) } });
    const receivedCount = await db.uploadChunk.count({ where: { uploadId } });
    return { index, sha256, received: receivedCount };
  } finally {
    chunkLocks.delete(lockKey);
  }
}

export async function completeUpload(auth: UploadAuth, uploadId: string, opts?: { sha256?: string | null; waitMs?: number }): Promise<UploadSessionDto> {
  const upload = await authorize(auth, uploadId);
  if (upload.status === "aborted" || upload.status === "expired") throw Errors.uploadClosed();
  if (upload.status === "active") {
    const chunks = await db.uploadChunk.findMany({ where: { uploadId }, select: { index: true, size: true } });
    const have = new Set(chunks.map((c) => c.index));
    const missing: number[] = [];
    for (let i = 0; i < upload.totalChunks; i++) if (!have.has(i)) missing.push(i);
    if (missing.length) throw Errors.incomplete(missing);
    if (chunks.reduce((n, c) => n + c.size, 0) !== Number(upload.size)) throw Errors.conflict("The received data does not add up to the declared file size.");
    const claimed = opts?.sha256?.toLowerCase() ?? upload.expectedSha256;
    if (claimed && !/^[a-f0-9]{64}$/.test(claimed)) throw Errors.validation("sha256 must be a 64 character hex string.");
    const { count } = await db.upload.updateMany({ where: { id: uploadId, status: "active" }, data: { status: "finalizing", expectedSha256: claimed ?? null } });
    if (count > 0) await enqueueJob("finalize_upload", { uploadId }, { dedupeKey: `finalize:${uploadId}`, maxAttempts: 2 });
  }
  if (opts?.waitMs) {
    const deadline = Date.now() + opts.waitMs;
    while (Date.now() < deadline) {
      const current = await db.upload.findUnique({ where: { id: uploadId }, select: { status: true } });
      if (current && current.status !== "finalizing") break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return getUploadSession(auth, uploadId);
}

export async function abortUpload(auth: UploadAuth, uploadId: string): Promise<void> {
  const upload = await authorize(auth, uploadId);
  if (upload.status === "finalizing") throw Errors.conflict("This upload is being finalized and can't be cancelled now.");
  if (upload.status === "active") {
    await db.upload.update({ where: { id: uploadId }, data: { status: "aborted" } });
    await fsp.unlink(upload.stagingPath).catch(() => undefined);
    await db.uploadChunk.deleteMany({ where: { uploadId } });
  }
}

export interface DirectUploadInput {
  stream: Readable;
  fileName: string;
  folderId?: string | null;
  share?: boolean;
  expiresAt?: Date | null;
  password?: string | null;
  maxDownloads?: number | null;
  sha256?: string | null;
  replaceFileId?: string | null;
}

/**
 * One-request upload for API clients (curl -F, PUT). The body is streamed to disk with a hard byte cap,
 * then goes through the same finalization path (hashing, type detection, storage, scanning) as chunked uploads.
 */
export async function directUpload(actor: Actor, input: DirectUploadInput): Promise<UploadSessionDto> {
  assertCan(actor, "write");
  await ensureDataDirsOnce();
  const settings = await getSettings();
  if (settings.maintenance.enabled && settings.maintenance.disableUploads) throw Errors.maintenance(settings.maintenance.message);
  const scope = scopeOf(actor);
  const ent = await entitlementsForActor(actor);
  const fileName = sanitizeFilename(input.fileName || "file");
  const ext = safeExtension(fileName);
  checkExtension(settings, ext);
  if (input.replaceFileId) await assertFeature(ent, "fileVersioning");
  await assertShareOptionsAllowed(actor, input);
  if (input.folderId) await getOwnedFolder(scope, input.folderId);
  const expiresAt = resolveExpiry(limitsFromEntitlements(ent), input.expiresAt);
  const maxFile = ent.limits.maxFileBytes;

  const id = newId("upl");
  const path = stagingPath(id);
  let written = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      written += chunk.length;
      if (maxFile >= 0 && written > maxFile) return cb(Errors.fileTooLarge(formatBytes(maxFile)));
      cb(null, chunk);
    },
  });
  try {
    await pipeline(input.stream, meter, fs.createWriteStream(path));
    if (written === 0) throw Errors.validation("Empty files can't be uploaded.");
    await assertUploadAllowed(scope, ent, { size: written, ext });
  } catch (err) {
    await fsp.unlink(path).catch(() => undefined);
    throw err;
  }
  await db.upload.create({
    data: {
      id,
      ownerId: actor.user.id,
      orgId: scope.orgId,
      folderId: input.folderId ?? null,
      replaceFileId: input.replaceFileId ?? null,
      fileName,
      size: BigInt(written),
      chunkSize: written,
      totalChunks: 1,
      status: "finalizing",
      stagingPath: path,
      expectedSha256: input.sha256?.toLowerCase() ?? null,
      // Private unless asked for: a link is only created when requested, or when a link-only option (password, download limit) implies one.
      share: !input.replaceFileId && (input.share ?? !!(input.password || input.maxDownloads)),
      expiresAt,
      sharePasswordHash: input.password ? await hashPassword(input.password) : null,
      maxDownloads: input.maxDownloads ?? null,
      sessionExpiresAt: new Date(Date.now() + 3600_000),
    },
  });
  await finalizeUpload(id);
  return getUploadSession({ actor }, id);
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(path, { highWaterMark: 1024 * 1024 })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function failUpload(upload: Upload, message: string, notifyUser = true) {
  await db.upload.update({ where: { id: upload.id }, data: { status: "failed", error: message } });
  await fsp.unlink(upload.stagingPath).catch(() => undefined);
  await db.uploadChunk.deleteMany({ where: { uploadId: upload.id } });
  if (notifyUser && !upload.requestId) {
    await notify({ userId: upload.ownerId, type: "upload_failed", title: "Upload failed", body: `${upload.fileName}: ${message}`, href: "/files" });
  }
}

/** Reads image dimensions so the media library can show them. (Video/audio duration is read by the media job.) */
async function imageInfo(path: string): Promise<string | null> {
  try {
    const { default: sharp } = await import("sharp");
    const m = await sharp(path, { failOn: "none", limitInputPixels: 300_000_000 }).metadata();
    return JSON.stringify({ width: m.width, height: m.height, orientation: m.orientation, hasAlpha: m.hasAlpha, format: m.format });
  } catch {
    return null;
  }
}

/** Runs in the background worker: verifies, stores, and registers the finished upload. */
export async function finalizeUpload(uploadId: string): Promise<void> {
  const upload = await db.upload.findUnique({ where: { id: uploadId } });
  if (!upload || upload.status !== "finalizing") return;
  const settings = await getSettings();
  const scope: Scope = { userId: upload.ownerId, orgId: upload.orgId };
  const workspaceId = workspaceIdOf(scope);
  const owner = await db.user.findUnique({ where: { id: upload.ownerId } });
  if (!owner) return failUpload(upload, "The account no longer exists.", false);

  try {
    const st = await fsp.stat(upload.stagingPath).catch(() => null);
    if (!st || st.size !== Number(upload.size)) return failUpload(upload, "The uploaded data was incomplete. Please upload the file again.");

    const sha256 = await hashFile(upload.stagingPath);
    if (upload.expectedSha256 && upload.expectedSha256 !== sha256) {
      return failUpload(upload, "The file's checksum did not match what was sent. Please upload it again.");
    }
    const detected = await detectType(upload.stagingPath, upload.fileName);
    try {
      checkExtension(settings, detected.extension);
    } catch (err) {
      return failUpload(upload, (err as Error).message);
    }
    const mediaInfo = detected.category === "image" ? await imageInfo(upload.stagingPath) : null;
    const scannerOn = settings.scanner.provider !== "none" && Number(upload.size) <= settings.scanner.maxBytes;
    const storageKey = newStorageKey();
    await storage().putFile(storageKey, upload.stagingPath);
    const actorInfo = { actorId: upload.requestId ? null : upload.ownerId, actorLabel: upload.requestId ? `${upload.uploaderLabel || "Anonymous"} (via request)` : owner.displayName };

    let fileId: string;
    let name: string;
    if (upload.replaceFileId) {
      // New content for an existing file: the current content becomes an older version.
      const current = await db.file.findFirst({ where: { id: upload.replaceFileId, deletedAt: null } });
      if (!current) {
        await storage().delete(storageKey).catch(() => undefined);
        return failUpload(upload, "The file being replaced no longer exists.");
      }
      await archiveCurrentAsVersion(current, upload.ownerId);
      for (const key of thumbKeysOf(current.thumbnailKey)) await storage().delete(key).catch(() => undefined);
      await db.file.update({
        where: { id: current.id },
        data: {
          storageKey,
          size: upload.size,
          sha256,
          mime: detected.mime,
          category: detected.category,
          version: current.version + 1,
          thumbnailKey: null,
          mediaInfo,
          status: scannerOn ? "scanning" : "available",
          scanStatus: scannerOn ? "pending" : "not_scanned",
        },
      });
      await pruneVersions(current.id, scope);
      fileId = current.id;
      name = current.originalName;
      await emit({ type: "file.version_created", workspaceId, ownerId: upload.ownerId, orgId: upload.orgId, ...actorInfo, fileId, targetName: name, data: { version: current.version + 1, size: Number(upload.size) } });
    } else {
      // Names must be unique within a folder; collisions get a numeric suffix instead of failing.
      const siblings = await db.file.findMany({ where: { ...(scope.orgId ? { orgId: scope.orgId } : { ownerId: scope.userId, orgId: null }), folderId: upload.folderId, deletedAt: null }, select: { originalName: true } });
      name = uniqueName(upload.fileName, new Set(siblings.map((s) => s.originalName.toLowerCase())));
      fileId = newId("fil");
      await db.file.create({
        data: {
          id: fileId,
          ownerId: upload.ownerId,
          orgId: upload.orgId,
          folderId: upload.folderId,
          requestId: upload.requestId,
          uploaderLabel: upload.uploaderLabel,
          originalName: name,
          nameKey: name.toLowerCase(),
          safeName: name,
          mime: detected.mime,
          extension: detected.extension,
          category: detected.category,
          size: upload.size,
          storageKey,
          sha256,
          mediaInfo,
          status: scannerOn ? "scanning" : "available",
          scanStatus: scannerOn ? "pending" : "not_scanned",
          expiresAt: upload.expiresAt,
        },
      });
      if (upload.share) {
        const link = await db.shareLink.create({
          data: { id: newId("shr"), token: newShareToken(), fileId, ownerId: upload.ownerId, passwordHash: upload.sharePasswordHash, maxDownloads: upload.maxDownloads },
        });
        await audit({ actorType: "user", actorId: upload.ownerId, action: "share.created", targetType: "file", targetId: fileId, metadata: { shareId: link.id, protected: !!link.passwordHash, viaUpload: true } });
      }
      await emit({ type: "file.uploaded", workspaceId, ownerId: upload.ownerId, orgId: upload.orgId, ...actorInfo, fileId, folderId: upload.folderId, targetName: name, data: { size: Number(upload.size), mime: detected.mime, viaRequest: upload.requestId ?? undefined } });
    }

    await db.upload.update({ where: { id: upload.id }, data: { status: "complete", fileId } });
    await db.uploadChunk.deleteMany({ where: { uploadId: upload.id } });
    await addUsage(subjectOf(scope), "uploadBytes", upload.size);

    if (scannerOn) await enqueueJob("scan_file", { fileId }, { dedupeKey: `scan:${fileId}:${upload.id}` });
    else await enqueueJob("media", { fileId }, { dedupeKey: `media:${fileId}:${upload.id}` });

    await audit({ actorType: upload.requestId ? "external" : "user", actorId: upload.ownerId, action: "file.uploaded", targetType: "file", targetId: fileId, metadata: { name, size: Number(upload.size), mime: detected.mime, ...(upload.requestId ? { requestId: upload.requestId } : {}) } });

    if (upload.requestId) {
      const request = await db.fileRequest.update({ where: { id: upload.requestId }, data: { uploadCount: { increment: 1 }, totalBytes: { increment: upload.size } } }).catch(() => null);
      await emit({ type: "request.upload_received", workspaceId, ownerId: upload.ownerId, orgId: upload.orgId, actorLabel: upload.uploaderLabel, fileId, targetName: name, data: { requestId: upload.requestId, requestName: request?.name, size: Number(upload.size) } });
      if (request?.notifyOnUpload) {
        await notify({ userId: upload.ownerId, type: "request_received", title: `New upload to “${request.name}”`, body: `${upload.uploaderLabel ? `${upload.uploaderLabel} sent` : "Someone sent"} ${name} (${formatBytes(Number(upload.size))}).`, href: `/requests`, dedupeKey: `req:${request.id}:${Math.floor(Date.now() / 600_000)}`, dedupeHours: 1 });
      }
    } else if (Number(upload.size) >= NOTIFY_MIN_BYTES) {
      await notify({ userId: upload.ownerId, type: "upload_complete", title: "Upload complete", body: `${name} (${formatBytes(Number(upload.size))}) is ready.`, href: `/file/${fileId}` });
    }
    const ent = await entitlementsForScope(scope, owner);
    await checkQuotaWarning(scope, ent);
  } catch (err) {
    console.error("[uploads] finalize failed", uploadId, err);
    await failUpload(upload, "Something went wrong while saving the file. Please try again.");
  }
}

export { assertLimit };
