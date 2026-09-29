import type { File as FileRow, Folder } from "@prisma/client";
import { db } from "../db";
import { Errors } from "../errors";
import { previewKind, type FileCategory } from "@/lib/fileTypes";
import type { FileStatus, MediaInfo, PublicShareDto, ScanStatus } from "@/lib/types";
import { scopeWhere } from "./actor";
import { collectFolderFiles } from "./folders";
import { parseJson, sharePermissions } from "./serializers";
import { isShareUnlocked, resolveShare } from "./shares";

const scopeOfFolder = (folder: Pick<Folder, "ownerId" | "orgId">) => ({ userId: folder.ownerId, orgId: folder.orgId });

/** Data for the public download page. Nothing about the target is revealed until the password is supplied. */
export async function describeShare(req: Request, token: string, ip?: string): Promise<PublicShareDto> {
  const { share, file, folder, owner } = await resolveShare(token, { forPage: true, ip });
  const unlocked = isShareUnlocked(req, share);
  const base: PublicShareDto = {
    token,
    kind: file ? "file" : "folder",
    requiresPassword: !!share.passwordHash,
    unlocked,
    title: share.title,
    message: share.message,
    permissions: sharePermissions(share),
    owner: { name: owner.displayName, brandName: share.title, accent: null },
    shareExpiresAt: share.expiresAt?.toISOString() ?? null,
    maxDownloads: share.maxDownloads,
    downloadsLeft: share.maxDownloads == null ? null : Math.max(0, share.maxDownloads - share.downloadCount),
    embedEnabled: share.embedEnabled,
  };
  if (!unlocked) return { ...base, title: null, message: null, file: undefined, folder: undefined };

  if (file) {
    base.file = {
      id: file.id,
      name: file.originalName,
      extension: file.extension,
      mime: file.mime,
      category: file.category as FileCategory,
      size: Number(file.size),
      sha256: share.showSha256 ? file.sha256 : null,
      status: file.status as FileStatus,
      scanStatus: file.scanStatus as ScanStatus,
      previewKind: previewKind(file.mime, file.extension),
      hasThumbnail: !!file.thumbnailKey,
      createdAt: file.createdAt.toISOString(),
      expiresAt: file.expiresAt?.toISOString() ?? null,
      downloadCount: file.downloadCount,
      mediaInfo: parseJson<MediaInfo | null>(file.mediaInfo, null),
    };
  } else if (folder) {
    const entries = await collectFolderFiles(scopeOfFolder(folder), [folder.id]);
    base.folder = {
      name: folder.name,
      fileCount: entries.length,
      totalSize: entries.reduce((n, e) => n + Number(e.file.size), 0),
      items: entries.slice(0, 500).map((e) => ({
        id: e.file.id,
        name: e.file.originalName,
        size: Number(e.file.size),
        mime: e.file.mime,
        category: e.file.category as FileCategory,
        previewKind: previewKind(e.file.mime, e.file.extension),
        hasThumbnail: !!e.file.thumbnailKey,
        path: e.path.split("/").slice(1).join("/") || e.file.originalName,
        status: e.file.status as FileStatus,
      })),
    };
  }
  return base;
}

/** A file inside a shared folder is only reachable if the folder chain leads up to the shared root. */
export async function assertFileInSharedFolder(folder: Folder, fileId: string): Promise<FileRow> {
  const file = await db.file.findFirst({ where: { id: fileId, ...scopeWhere(scopeOfFolder(folder)), deletedAt: null } });
  if (!file || !file.folderId) throw Errors.notFound();
  let current: string | null = file.folderId;
  for (let depth = 0; current && depth < 64; depth++) {
    if (current === folder.id) return file;
    const parent: { parentId: string | null; deletedAt: Date | null } | null = await db.folder.findUnique({ where: { id: current }, select: { parentId: true, deletedAt: true } });
    if (!parent || parent.deletedAt) break;
    current = parent.parentId;
  }
  throw Errors.notFound();
}
