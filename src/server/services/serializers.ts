import type { File as FileRow, Folder as FolderRow, ShareLink, Tag, User } from "@prisma/client";
import { env } from "../env";
import { categorize, previewKind, type FileCategory } from "@/lib/fileTypes";
import type { FileDto, FileStatus, FolderDto, MediaInfo, ScanStatus, ShareDto, SharePermission, ShareState, TagDto, UserDto } from "@/lib/types";

export function shareUrl(token: string): string {
  return `${env.appUrl}/d/${token}`;
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function shareState(share: Pick<ShareLink, "revokedAt" | "expiresAt" | "maxDownloads" | "downloadCount" | "maxViews" | "viewCount">, now = Date.now()): ShareState {
  if (share.revokedAt) return "revoked";
  if (share.expiresAt && share.expiresAt.getTime() <= now) return "expired";
  if (share.maxDownloads != null && share.downloadCount >= share.maxDownloads) return "exhausted";
  if (share.maxViews != null && share.viewCount >= share.maxViews) return "exhausted";
  return "active";
}

export function sharePermissions(share: Pick<ShareLink, "permissions">): SharePermission[] {
  const list = share.permissions.split(",").filter((p): p is SharePermission => p === "view" || p === "download");
  return list.length ? list : ["view", "download"];
}

export function serializeShare(share: ShareLink, targetName?: string | null): ShareDto {
  return {
    id: share.id,
    token: share.token,
    url: shareUrl(share.token),
    fileId: share.fileId,
    folderId: share.folderId,
    targetName: targetName ?? null,
    hasPassword: !!share.passwordHash,
    permissions: sharePermissions(share),
    title: share.title,
    message: share.message,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    maxDownloads: share.maxDownloads,
    maxViews: share.maxViews,
    downloadCount: share.downloadCount,
    viewCount: share.viewCount,
    ipAllowlist: parseJson<string[]>(share.ipAllowlist, []),
    showSha256: share.showSha256,
    embedEnabled: share.embedEnabled,
    revokedAt: share.revokedAt?.toISOString() ?? null,
    lastAccessedAt: share.lastAccessedAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
    state: shareState(share),
  };
}

/** The share shown in lists: the newest one that still works, or nothing. */
export function primaryShare(shares: ShareLink[] | undefined): { share: ShareLink | null; count: number } {
  const usable = (shares ?? []).filter((s) => shareState(s) === "active").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { share: usable[0] ?? null, count: usable.length };
}

export const serializeTag = (t: Pick<Tag, "id" | "name" | "color">): TagDto => ({ id: t.id, name: t.name, color: t.color });

export type FileWithRelations = FileRow & {
  shares?: ShareLink[];
  favorites?: { id: string }[];
  owner?: Pick<User, "id" | "displayName"> | null;
  tags?: Array<{ tag: Tag }>;
  _count?: { comments?: number; versions?: number };
};

export function serializeFile(file: FileWithRelations, opts?: { includeOwner?: boolean }): FileDto {
  const { share, count } = primaryShare(file.shares);
  return {
    id: file.id,
    name: file.originalName,
    extension: file.extension,
    mime: file.mime,
    category: (file.category as FileCategory) || categorize(file.mime, file.extension),
    size: Number(file.size),
    sha256: file.sha256,
    status: file.status as FileStatus,
    scanStatus: file.scanStatus as ScanStatus,
    quarantineNote: file.quarantineNote,
    folderId: file.folderId,
    orgId: file.orgId,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    lastAccessedAt: file.lastAccessedAt?.toISOString() ?? null,
    lastDownloadAt: file.lastDownloadAt?.toISOString() ?? null,
    expiresAt: file.expiresAt?.toISOString() ?? null,
    archivedAt: file.archivedAt?.toISOString() ?? null,
    deletedAt: file.deletedAt?.toISOString() ?? null,
    downloadCount: file.downloadCount,
    favorite: (file.favorites?.length ?? 0) > 0,
    previewKind: previewKind(file.mime, file.extension),
    hasThumbnail: !!file.thumbnailKey,
    share: share ? serializeShare(share, file.originalName) : null,
    shareCount: count,
    version: file.version,
    versionCount: (file._count?.versions ?? 0) + 1,
    description: file.description,
    notes: file.notes,
    colorLabel: file.colorLabel,
    metadata: parseJson<Record<string, string>>(file.metadata, {}),
    tags: (file.tags ?? []).map((t) => serializeTag(t.tag)).sort((a, b) => a.name.localeCompare(b.name)),
    mediaInfo: parseJson<MediaInfo | null>(file.mediaInfo, null),
    commentCount: file._count?.comments ?? 0,
    owner: opts?.includeOwner ? (file.owner ? { id: file.owner.id, name: file.owner.displayName } : null) : undefined,
  };
}

export type FolderWithRelations = FolderRow & { shares?: ShareLink[]; favorites?: { id: string }[] };

export function serializeFolder(folder: FolderWithRelations): FolderDto {
  const { share } = primaryShare(folder.shares);
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    orgId: folder.orgId,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    archivedAt: folder.archivedAt?.toISOString() ?? null,
    deletedAt: folder.deletedAt?.toISOString() ?? null,
    description: folder.description,
    color: folder.color,
    favorite: (folder.favorites?.length ?? 0) > 0,
    share: share ? serializeShare(share, folder.name) : null,
  };
}

export function serializeUser(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    role: user.role as UserDto["role"],
    status: user.status as UserDto["status"],
    planKey: user.planKey,
    bio: user.bio,
    timezone: user.timezone,
    language: user.language,
    theme: user.theme,
    avatarUrl: user.avatarKey ? `/api/v1/users/${user.id}/avatar?v=${user.updatedAt.getTime()}` : null,
    emailVerified: !!user.emailVerifiedAt,
    twoFactorEnabled: !!user.totpEnabledAt,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
