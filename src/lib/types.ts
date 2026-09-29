import type { FileCategory, PreviewKind } from "./fileTypes";

export type FileStatus = "processing" | "scanning" | "available" | "quarantined" | "failed";
export type ScanStatus = "pending" | "scanning" | "clean" | "infected" | "error" | "not_scanned";
export type ShareState = "active" | "expired" | "revoked" | "exhausted";
export type OrgRoleName = "owner" | "admin" | "member" | "viewer";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface TagDto {
  id: string;
  name: string;
  color: string;
}

export interface MediaInfo {
  width?: number;
  height?: number;
  duration?: number;
  orientation?: number;
  hasAlpha?: boolean;
  format?: string;
}

export type SharePermission = "view" | "download";

export interface ShareDto {
  id: string;
  token: string;
  url: string;
  fileId: string | null;
  folderId: string | null;
  targetName: string | null;
  hasPassword: boolean;
  permissions: SharePermission[];
  title: string | null;
  message: string | null;
  expiresAt: string | null;
  maxDownloads: number | null;
  maxViews: number | null;
  downloadCount: number;
  viewCount: number;
  ipAllowlist: string[];
  showSha256: boolean;
  embedEnabled: boolean;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  createdAt: string;
  state: ShareState;
}

export interface FileDto {
  id: string;
  name: string;
  extension: string;
  mime: string;
  category: FileCategory;
  size: number;
  sha256: string;
  status: FileStatus;
  scanStatus: ScanStatus;
  quarantineNote: string | null;
  folderId: string | null;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  lastDownloadAt: string | null;
  expiresAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  downloadCount: number;
  favorite: boolean;
  previewKind: PreviewKind | null;
  hasThumbnail: boolean;
  share: ShareDto | null;
  shareCount: number;
  version: number;
  versionCount: number;
  description: string;
  notes: string;
  colorLabel: string | null;
  metadata: Record<string, string>;
  tags: TagDto[];
  mediaInfo: MediaInfo | null;
  commentCount: number;
  owner?: { id: string; name: string } | null;
}

export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  description: string;
  color: string | null;
  favorite: boolean;
  share: ShareDto | null;
}

export interface Breadcrumb {
  id: string | null;
  name: string;
}

export interface FileListResponse {
  folders: FolderDto[];
  files: FileDto[];
  nextCursor: string | null;
  breadcrumbs: Breadcrumb[];
  total: number;
  /** Messages about parts of the search query that couldn't be understood. */
  queryErrors: string[];
}

export interface TrashItemDto {
  id: string;
  kind: "file" | "folder";
  itemId: string;
  name: string;
  size: number;
  itemCount: number;
  deletedAt: string;
  purgeAt: string;
}

export interface UploadSessionDto {
  id: string;
  fileName: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  received: number[];
  status: "active" | "finalizing" | "complete" | "aborted" | "expired" | "failed";
  expiresAt: string;
  file: FileDto | null;
  shareUrl: string | null;
  error: string | null;
  /** External (file request) uploads authenticate follow-up calls with this per-upload secret. */
  uploadKey?: string;
}

export interface UserDto {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  role: "user" | "admin";
  status: "active" | "suspended";
  planKey: string;
  bio: string;
  timezone: string;
  language: string;
  theme: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface UsageDto {
  usedBytes: number;
  quotaBytes: number;
  fileCount: number;
  maxFileBytes: number;
  percent: number;
}

export interface LimitsDto {
  maxFileBytes: number;
  quotaBytes: number;
  /** Longest a file may be set to live; -1 = unlimited (files may also be kept forever). */
  maxRetentionDays: number;
  allowNever: boolean;
}

export interface PublicConfigDto {
  chunkSizeBytes: number;
  clientConcurrency: number;
  blockedExtensions: string[];
  allowedExtensions: string[];
  registrationEnabled: boolean;
  maintenance: { enabled: boolean; message: string; disableUploads: boolean; allowDownloads: boolean };
  scannerEnabled: boolean;
  plan: { key: string; name: string } | null;
  limits: LimitsDto | null;
  usage: UsageDto | null;
}

/** Config for a signed-in caller: limits and usage are always present. */
export type AuthedConfigDto = PublicConfigDto & { limits: LimitsDto; usage: UsageDto };

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface SessionDto {
  id: string;
  userAgent: string | null;
  deviceLabel: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ArchiveJobDto {
  id: string;
  name: string;
  status: "queued" | "running" | "ready" | "failed" | "expired";
  totalFiles: number;
  processedFiles: number;
  totalBytes: number;
  processedBytes: number;
  size: number | null;
  error: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface PublicShareDto {
  token: string;
  kind: "file" | "folder";
  requiresPassword: boolean;
  unlocked: boolean;
  title: string | null;
  message: string | null;
  permissions: SharePermission[];
  owner: { name: string; brandName: string | null; accent: string | null } | null;
  file?: {
    id: string;
    name: string;
    extension: string;
    mime: string;
    category: FileCategory;
    size: number;
    sha256: string | null;
    status: FileStatus;
    scanStatus: ScanStatus;
    previewKind: PreviewKind | null;
    hasThumbnail: boolean;
    createdAt: string;
    expiresAt: string | null;
    downloadCount: number;
    mediaInfo: MediaInfo | null;
  };
  folder?: {
    name: string;
    fileCount: number;
    totalSize: number;
    items: Array<{ id: string; name: string; size: number; mime: string; category: FileCategory; previewKind: PreviewKind | null; hasThumbnail: boolean; path: string; status: FileStatus }>;
  };
  shareExpiresAt: string | null;
  maxDownloads: number | null;
  downloadsLeft: number | null;
  embedEnabled: boolean;
}

/** API key permissions. `files:write` (modify) also allows uploading; delete is separate so keys can be least-privilege. */
export const SCOPES = ["files:read", "files:upload", "files:write", "files:delete", "folders:write", "shares:write", "webhooks:write", "automations:read", "automations:write", "usage:read"] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_LABELS: Record<Scope, string> = {
  "files:read": "Read files and folders",
  "files:upload": "Upload files",
  "files:write": "Modify files (rename, move, tag, versions)",
  "files:delete": "Delete files and folders",
  "folders:write": "Create and change folders",
  "shares:write": "Manage share links",
  "webhooks:write": "Manage webhooks",
  "automations:read": "View automations and their runs",
  "automations:write": "Manage automations",
  "usage:read": "Read usage and analytics",
};

export const REPORT_CATEGORIES = [
  { value: "malware", label: "Malware or phishing" },
  { value: "copyright", label: "Copyright issue" },
  { value: "illegal", label: "Illegal content" },
  { value: "spam", label: "Spam" },
  { value: "abuse", label: "Harassment or abuse" },
  { value: "other", label: "Something else" },
] as const;

export const TAG_COLORS = ["#6b7691", "#2557e8", "#0f9d8a", "#3aa655", "#d99a1c", "#e2703a", "#d4453f", "#9556d6", "#d24f95"] as const;
