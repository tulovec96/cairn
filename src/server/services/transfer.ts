import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { z } from "zod";
import { db } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import * as rate from "../ratelimit";
import { safeFetchFollow, parseSafeUrl } from "../security/ssrf";
import { sanitizeFilename, uniqueName } from "../security/filenames";
import { getSettings } from "../settings";
import { storage } from "../storage";
import { actorForBackgroundWork, scopeOf, type Actor } from "./actor";
import { audit } from "./audit";
import { ensureDataDirsOnce } from "./bootstrap";
import { getOwnedFolder } from "./folders";
import { assertFeature } from "./entitlements";
import { entitlementsForActor } from "./limits";
import { notify } from "./notifications";
import { assertCan } from "./permissions";
import { directUpload } from "./uploads";

// ---------------------------------------------------------------------------------------------
// Import from URL
// ---------------------------------------------------------------------------------------------

export const importSchema = z.object({
  url: z.string().trim().min(8).max(2000),
  folderId: z.string().max(40).nullable().optional(),
});

export interface ImportDto {
  id: string;
  url: string;
  status: string;
  progress: number;
  fileId: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

const importDto = (j: { id: string; sourceRef: string; status: string; progress: number; fileId: string | null; error: string | null; createdAt: Date; finishedAt: Date | null }): ImportDto => ({
  id: j.id,
  url: j.sourceRef,
  status: j.status,
  progress: j.progress,
  fileId: j.fileId,
  error: j.error,
  createdAt: j.createdAt.toISOString(),
  finishedAt: j.finishedAt?.toISOString() ?? null,
});

export async function createImport(actor: Actor, input: z.infer<typeof importSchema>): Promise<ImportDto> {
  assertCan(actor, "write");
  const settings = await getSettings();
  rate.enforce(`import:${actor.user.id}`, { limit: 30, windowSec: 3600 });
  await assertFeature(await entitlementsForActor(actor), "urlImport");
  const url = parseSafeUrl(input.url, { allowPrivate: false });
  if (input.folderId) await getOwnedFolder(scopeOf(actor), input.folderId);
  if (actor.workspace.orgId) throw Errors.validation("URL imports go to your personal files. Switch to your personal workspace first.");
  if (settings.maintenance.enabled && settings.maintenance.disableUploads) throw Errors.maintenance(settings.maintenance.message);
  const job = await db.importJob.create({ data: { id: newId("imp"), userId: actor.user.id, source: "url", sourceRef: url.toString().slice(0, 2000), folderId: input.folderId ?? null } });
  await enqueueJob("import_url", { importId: job.id }, { dedupeKey: `import:${job.id}`, maxAttempts: 1, userId: actor.user.id });
  await audit({ actorType: "user", actorId: actor.user.id, action: "import.requested", targetType: "import", targetId: job.id, metadata: { host: url.hostname } });
  return importDto(job);
}

export async function listImports(actor: Actor): Promise<ImportDto[]> {
  return (await db.importJob.findMany({ where: { userId: actor.user.id }, orderBy: { createdAt: "desc" }, take: 30 })).map(importDto);
}

function nameFromResponse(res: { headers: { get(n: string): string | null } }, url: URL): string {
  const cd = res.headers.get("content-disposition");
  const star = cd && /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  const plain = cd && /filename="?([^";]+)"?/i.exec(cd);
  let raw = "";
  try {
    raw = star ? decodeURIComponent(star[1].trim()) : plain ? plain[1] : "";
  } catch {
    raw = plain ? plain[1] : "";
  }
  if (!raw) raw = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "").trim();
  return sanitizeFilename(raw || "download");
}

/** Runs in the job queue. The response body is streamed through the normal upload pipeline (size caps, type checks, hashing, scanning). */
export async function runImport(importId: string): Promise<void> {
  const job = await db.importJob.findUnique({ where: { id: importId } });
  if (!job || job.status !== "queued") return;
  await db.importJob.update({ where: { id: importId }, data: { status: "running" } });
  try {
    const actor = await actorForBackgroundWork(job.userId, null);
    const res = await safeFetchFollow(job.sourceRef, { headers: { "user-agent": "Cairn-Import/1.0", accept: "*/*" }, signal: AbortSignal.timeout(30 * 60_000) }, 3);
    if (!res.ok || !res.body) throw new Error(`The server answered ${res.status}.`);
    const ent = await entitlementsForActor(actor);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (ent.limits.maxFileBytes >= 0 && declared > ent.limits.maxFileBytes) throw Errors.fileTooLarge(String(ent.limits.maxFileBytes));
    const name = nameFromResponse(res, new URL(job.sourceRef));
    const session = await directUpload(actor, { stream: Readable.fromWeb(res.body as never), fileName: name, folderId: job.folderId, share: false });
    await db.importJob.update({ where: { id: importId }, data: { status: session.file ? "done" : "failed", progress: 100, fileId: session.file?.id ?? null, error: session.file ? null : (session.error ?? "The file could not be saved."), finishedAt: new Date() } });
    if (session.file) await audit({ actorType: "user", actorId: job.userId, action: "file.imported", targetType: "file", targetId: session.file.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The import failed.";
    await db.importJob.update({ where: { id: importId }, data: { status: "failed", error: message.slice(0, 300), finishedAt: new Date() } });
    await notify({ userId: job.userId, type: "upload_failed", title: "An import failed", body: message.slice(0, 200), href: "/import" });
  }
}

// ---------------------------------------------------------------------------------------------
// Account data export
// ---------------------------------------------------------------------------------------------

export interface DataExportDto {
  id: string;
  status: string;
  size: number | null;
  error: string | null;
  createdAt: string;
  expiresAt: string;
}

const exportDto = (e: { id: string; status: string; size: bigint | null; error: string | null; createdAt: Date; expiresAt: Date }): DataExportDto => ({
  id: e.id,
  status: e.status,
  size: e.size == null ? null : Number(e.size),
  error: e.error,
  createdAt: e.createdAt.toISOString(),
  expiresAt: e.expiresAt.toISOString(),
});

export async function requestExport(actor: Actor): Promise<DataExportDto> {
  const settings = await getSettings();
  const active = await db.dataExport.findFirst({ where: { userId: actor.user.id, status: { in: ["queued", "running"] } } });
  if (active) throw Errors.conflict("An export is already being prepared.");
  rate.enforce(`export:${actor.user.id}`, { limit: 3, windowSec: 24 * 3600 }, "You can request up to 3 exports a day.");
  const row = await db.dataExport.create({ data: { id: newId("exp"), userId: actor.user.id, expiresAt: new Date(Date.now() + settings.files.exportTtlHours * 3600_000) } });
  await enqueueJob("build_export", { exportId: row.id }, { dedupeKey: `export:${row.id}`, maxAttempts: 2, userId: actor.user.id });
  await audit({ actorType: "user", actorId: actor.user.id, action: "export.requested", targetType: "export", targetId: row.id });
  return exportDto(row);
}

export async function listExports(actor: Actor): Promise<DataExportDto[]> {
  return (await db.dataExport.findMany({ where: { userId: actor.user.id, status: { not: "expired" } }, orderBy: { createdAt: "desc" }, take: 10 })).map(exportDto);
}

export async function getExportForDownload(actor: Actor, id: string) {
  const row = await db.dataExport.findFirst({ where: { id, userId: actor.user.id } });
  if (!row || row.status !== "ready" || !row.storageKey) throw Errors.notFound("That export isn't available.");
  if (row.expiresAt.getTime() <= Date.now()) throw Errors.gone("That export has expired.");
  return row;
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x), 2);

/** Everything the account holds: profile, structure, metadata, shares (without secrets) and the personal files themselves. */
export async function buildExport(exportId: string): Promise<void> {
  const row = await db.dataExport.findUnique({ where: { id: exportId } });
  if (!row || row.status === "ready" || row.status === "expired") return;
  await ensureDataDirsOnce();
  await db.dataExport.update({ where: { id: exportId }, data: { status: "running", error: null } });
  const tmpPath = path.join(env.tmpDir, "archives", `${exportId}.zip`);
  try {
    const userId = row.userId;
    const [user, folders, files, shares, comments, sessions, apiKeys, tags, saved, notifications, requests, memberships] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: userId } }),
      db.folder.findMany({ where: { ownerId: userId, orgId: null } }),
      db.file.findMany({ where: { ownerId: userId, orgId: null, deletedAt: null }, include: { tags: { include: { tag: true } }, versions: true } }),
      db.shareLink.findMany({ where: { ownerId: userId } }),
      db.comment.findMany({ where: { authorId: userId } }),
      db.session.findMany({ where: { userId }, select: { deviceLabel: true, ip: true, createdAt: true, lastSeenAt: true } }),
      db.apiKey.findMany({ where: { userId }, select: { name: true, prefix: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true } }),
      db.tag.findMany({ where: { workspaceId: userId } }),
      db.savedSearch.findMany({ where: { userId } }),
      db.notification.findMany({ where: { userId }, take: 500, orderBy: { createdAt: "desc" } }),
      db.fileRequest.findMany({ where: { ownerId: userId }, select: { name: true, kind: true, description: true, createdAt: true, closedAt: true, uploadCount: true } }),
      db.organizationMember.findMany({ where: { userId }, include: { org: { select: { name: true } } } }),
    ]);

    const archive = new ZipArchive({ zlib: { level: 1 } });
    const output = fs.createWriteStream(tmpPath);
    const finished = new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
    });
    archive.pipe(output);

    const folderPath = new Map<string, string>();
    const byId = new Map(folders.map((f) => [f.id, f]));
    const pathFor = (id: string): string => {
      const cached = folderPath.get(id);
      if (cached) return cached;
      const f = byId.get(id);
      const p = f ? (f.parentId && byId.has(f.parentId) ? `${pathFor(f.parentId)}/${f.name}` : f.name) : "";
      folderPath.set(id, p);
      return p;
    };

    const profile: Record<string, unknown> = { ...user };
    for (const secret of ["passwordHash", "totpSecret", "backupCodes"]) delete profile[secret];
    archive.append(json({ exportedAt: new Date().toISOString(), profile }), { name: "account/profile.json" });
    archive.append(json({ organizations: memberships.map((m) => ({ name: m.org.name, role: m.role })), sessions, apiKeys, tags, savedSearches: saved, notifications, fileRequests: requests }), { name: "account/settings-and-activity.json" });
    archive.append(json(folders), { name: "library/folders.json" });
    archive.append(
      json(
        files.map((f) => ({
          id: f.id, name: f.originalName, folder: f.folderId ? pathFor(f.folderId) : "", size: f.size, mime: f.mime, sha256: f.sha256, version: f.version, description: f.description, notes: f.notes, colorLabel: f.colorLabel, metadata: f.metadata,
          tags: f.tags.map((t) => t.tag.name), createdAt: f.createdAt, expiresAt: f.expiresAt, versions: f.versions.map((v) => ({ version: v.version, size: v.size, sha256: v.sha256, createdAt: v.createdAt })),
        })),
      ),
      { name: "library/files.json" },
    );
    archive.append(json(shares.map((s) => ({ token: s.token, fileId: s.fileId, folderId: s.folderId, permissions: s.permissions, expiresAt: s.expiresAt, downloadCount: s.downloadCount, viewCount: s.viewCount, revokedAt: s.revokedAt, createdAt: s.createdAt, passwordProtected: !!s.passwordHash }))), { name: "library/shares.json" });
    archive.append(json(comments), { name: "library/comments.json" });

    const used = new Map<string, Set<string>>();
    for (const f of files) {
      if (f.status !== "available") continue;
      const dir = f.folderId ? pathFor(f.folderId) : "";
      const taken = used.get(dir) ?? new Set<string>();
      const name = uniqueName(f.originalName, taken);
      taken.add(name.toLowerCase());
      used.set(dir, taken);
      const source = storage().createReadStream(f.storageKey);
      await new Promise<void>((resolve, reject) => {
        source.once("error", reject);
        archive.once("entry", () => resolve());
        archive.append(source, { name: `files/${dir ? `${dir}/` : ""}${name}`, date: f.createdAt });
      });
    }
    await archive.finalize();
    await finished;
    const key = `exports/${exportId.replace(/^exp_/, "").toLowerCase()}.zip`;
    const size = (await fsp.stat(tmpPath)).size;
    await storage().putFile(key, tmpPath);
    await db.dataExport.update({ where: { id: exportId }, data: { status: "ready", storageKey: key, size: BigInt(size) } });
    await notify({ userId, type: "upload_complete", title: "Your data export is ready", body: "Download it from your account settings before it expires.", href: "/settings/data" });
  } catch (err) {
    await fsp.unlink(tmpPath).catch(() => undefined);
    await db.dataExport.update({ where: { id: exportId }, data: { status: "failed", error: "The export could not be created." } });
    throw err;
  }
}
