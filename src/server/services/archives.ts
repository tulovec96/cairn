import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import type { ArchiveJob } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import { uniqueName } from "../security/filenames";
import { getSettings } from "../settings";
import { storage } from "../storage";
import { formatBytes } from "@/lib/format";
import type { ArchiveJobDto } from "@/lib/types";
import { scopeOf, scopeWhere, type Actor, type Scope } from "./actor";
import { ensureDataDirsOnce } from "./bootstrap";
import { recordDownload } from "./download";
import { collectFolderFiles, type FolderFileEntry } from "./folders";

export interface ArchiveRequest {
  fileIds?: string[];
  folderIds?: string[];
}

/** Appends one entry and resolves when the archiver has fully consumed it (sequential, so only one file is open at a time). */
function appendEntry(archive: ZipArchive, source: Readable, name: string, date: Date): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      archive.off("entry", onEntry);
      archive.off("close", onClose);
      source.off("error", onSourceError);
    };
    const onEntry = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      source.destroy();
      reject(new Error("The archive stream was closed."));
    };
    const onSourceError = (err: Error) => {
      cleanup();
      reject(err);
    };
    archive.once("entry", onEntry);
    archive.once("close", onClose);
    source.once("error", onSourceError);
    archive.append(source, { name, date });
  });
}

export function toArchiveDto(job: ArchiveJob): ArchiveJobDto {
  return {
    id: job.id,
    name: job.name,
    status: job.status as ArchiveJobDto["status"],
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    totalBytes: Number(job.totalBytes),
    processedBytes: Number(job.processedBytes),
    size: job.size == null ? null : Number(job.size),
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
  };
}

async function collectEntries(scope: Scope, req: ArchiveRequest): Promise<FolderFileEntry[]> {
  const entries: FolderFileEntry[] = [];
  const fileIds = [...new Set(req.fileIds ?? [])];
  const folderIds = [...new Set(req.folderIds ?? [])];
  if (fileIds.length) {
    const files = await db.file.findMany({ where: { id: { in: fileIds }, ...scopeWhere(scope), deletedAt: null, status: "available" } });
    const taken = new Set<string>();
    for (const file of files) {
      const name = uniqueName(file.originalName, taken);
      taken.add(name.toLowerCase());
      entries.push({ file, path: name });
    }
  }
  if (folderIds.length) entries.push(...(await collectFolderFiles(scope, folderIds, { onlyAvailable: true })));
  return entries;
}

export async function createArchive(actor: Actor, req: ArchiveRequest): Promise<ArchiveJobDto> {
  await ensureDataDirsOnce();
  const settings = await getSettings();
  const scope = scopeOf(actor);
  const entries = await collectEntries(scope, req);
  if (!entries.length) throw Errors.validation("There are no downloadable files in your selection.");
  const totalBytes = entries.reduce((n, e) => n + Number(e.file.size), 0);
  if (totalBytes > settings.files.archiveMaxBytes) {
    throw Errors.validation(`This selection is ${formatBytes(totalBytes)}; archives are limited to ${formatBytes(settings.files.archiveMaxBytes)}. Download in smaller parts.`);
  }
  const single = !req.fileIds?.length && req.folderIds?.length === 1 ? entries[0].path.split("/")[0] : null;
  const name = `${single ?? `cairn-${new Date().toISOString().slice(0, 10)}`}.zip`;
  const job = await db.archiveJob.create({
    data: {
      id: newId("arc"),
      ownerId: actor.user.id,
      name,
      items: JSON.stringify({ fileIds: req.fileIds ?? [], folderIds: req.folderIds ?? [], orgId: scope.orgId }),
      totalFiles: entries.length,
      totalBytes: BigInt(totalBytes),
      expiresAt: new Date(Date.now() + settings.files.archiveTtlHours * 3600_000),
    },
  });
  await enqueueJob("build_archive", { archiveId: job.id }, { dedupeKey: `archive:${job.id}`, maxAttempts: 2, userId: actor.user.id });
  return toArchiveDto(job);
}

export async function getArchive(actor: Actor, id: string): Promise<ArchiveJob> {
  const job = await db.archiveJob.findFirst({ where: { id, ownerId: actor.user.id } });
  if (!job) throw Errors.notFound();
  return job;
}

/** Builds the ZIP on disk (streaming, so memory use is flat), tracking progress in the database. */
export async function buildArchive(archiveId: string, report?: (pct: number) => Promise<void>): Promise<void> {
  const job = await db.archiveJob.findUnique({ where: { id: archiveId } });
  if (!job || job.status === "ready" || job.status === "expired") return;
  await ensureDataDirsOnce();
  await db.archiveJob.update({ where: { id: archiveId }, data: { status: "running", error: null, processedBytes: 0n, processedFiles: 0 } });

  const tmpPath = path.join(env.tmpDir, "archives", `${archiveId}.zip`);
  try {
    const items = JSON.parse(job.items) as ArchiveRequest & { orgId?: string | null };
    const entries = await collectEntries({ userId: job.ownerId, orgId: items.orgId ?? null }, items);

    const archive = new ZipArchive({ zlib: { level: 1 } });
    const output = fs.createWriteStream(tmpPath);
    const finished = new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
    });
    archive.pipe(output);

    let processedBytes = 0;
    let lastFlush = 0;
    const flush = async (files: number, force = false) => {
      if (!force && Date.now() - lastFlush < 700) return;
      lastFlush = Date.now();
      await db.archiveJob.update({ where: { id: archiveId }, data: { processedFiles: files, processedBytes: BigInt(processedBytes) } });
      await report?.(Number(job.totalBytes) ? Math.min(99, Math.round((processedBytes / Number(job.totalBytes)) * 100)) : 0);
    };

    let done = 0;
    for (const entry of entries) {
      const source = storage().createReadStream(entry.file.storageKey);
      source.on("data", (c) => {
        processedBytes += (c as Buffer).length;
      });
      await appendEntry(archive, source, entry.path, entry.file.createdAt);
      done++;
      await flush(done);
    }
    await archive.finalize();
    await finished;
    await flush(done, true);

    const key = `archives/${archiveId.replace(/^arc_/, "").toLowerCase()}.zip`;
    const size = (await fsp.stat(tmpPath)).size;
    await storage().putFile(key, tmpPath);
    await db.archiveJob.update({ where: { id: archiveId }, data: { status: "ready", storageKey: key, size: BigInt(size), processedFiles: done } });
  } catch (err) {
    await fsp.unlink(tmpPath).catch(() => undefined);
    await db.archiveJob.update({ where: { id: archiveId }, data: { status: "failed", error: "The archive could not be created." } });
    throw err;
  }
}

/** Streams a ZIP straight to the client (used for public folder shares); nothing is buffered on disk or in memory. */
export function zipResponse(entries: FolderFileEntry[], headers: Headers, opts?: { shareId?: string | null }): Response {
  const archive = new ZipArchive({ zlib: { level: 1 } });
  (async () => {
    try {
      for (const entry of entries) {
        await appendEntry(archive, storage().createReadStream(entry.file.storageKey), entry.path, entry.file.createdAt);
        recordDownload(entry.file.id, opts?.shareId, Number(entry.file.size)).catch(() => undefined);
      }
      await archive.finalize();
    } catch {
      archive.destroy();
    }
  })();
  // toWeb() applies backpressure and destroys the archive if the client goes away.
  return new Response(Readable.toWeb(archive as unknown as Readable) as ReadableStream, { status: 200, headers });
}
