-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "suspendedReason" TEXT,
    "quotaBytes" BIGINT,
    "maxFileBytes" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "trashBatchId" TEXT,
    CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "guestSessionId" TEXT,
    "folderId" TEXT,
    "originalName" TEXT NOT NULL,
    "safeName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "size" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "quarantineNote" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadAt" DATETIME,
    "lastAccessedAt" DATETIME,
    "expiresAt" DATETIME,
    "deletedAt" DATETIME,
    "trashBatchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "File_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "File_guestSessionId_fkey" FOREIGN KEY ("guestSessionId") REFERENCES "GuestSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "File_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "guestSessionId" TEXT,
    "folderId" TEXT,
    "fileName" TEXT NOT NULL,
    "declaredMime" TEXT,
    "size" BIGINT NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "stagingPath" TEXT NOT NULL,
    "expectedSha256" TEXT,
    "share" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME,
    "sharePasswordHash" TEXT,
    "maxDownloads" INTEGER,
    "fileId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sessionExpiresAt" DATETIME NOT NULL,
    CONSTRAINT "Upload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Upload_guestSessionId_fkey" FOREIGN KEY ("guestSessionId") REFERENCES "GuestSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UploadChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uploadId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadChunk_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "fileId" TEXT,
    "folderId" TEXT,
    "ownerId" TEXT,
    "guestSessionId" TEXT,
    "passwordHash" TEXT,
    "expiresAt" DATETIME,
    "maxDownloads" INTEGER,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "showSha256" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" DATETIME,
    "lastAccessedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShareLink_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareLink_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareLink_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareLink_guestSessionId_fkey" FOREIGN KEY ("guestSessionId") REFERENCES "GuestSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Download" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "shareId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Download_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Download_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ShareLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AbuseReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "shareId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "contact" TEXT,
    "reporterKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "AbuseReport_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AbuseReport_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ShareLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VirusScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "signature" TEXT,
    "details" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "VirusScan_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fileId" TEXT,
    "folderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Favorite_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Favorite_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrashItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgeAt" DATETIME NOT NULL,
    CONSTRAINT "TrashItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "dedupeKey" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "ip" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "updatedById" TEXT
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "lockedAt" DATETIME,
    "dedupeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ArchiveJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "guestSessionId" TEXT,
    "name" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "processedFiles" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "processedBytes" BIGINT NOT NULL DEFAULT 0,
    "storageKey" TEXT,
    "size" BIGINT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "ArchiveJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArchiveJob_guestSessionId_fkey" FOREIGN KEY ("guestSessionId") REFERENCES "GuestSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatSnapshot" (
    "day" TEXT NOT NULL PRIMARY KEY,
    "users" INTEGER NOT NULL,
    "files" INTEGER NOT NULL,
    "guestFiles" INTEGER NOT NULL,
    "storageBytes" BIGINT NOT NULL,
    "downloads" INTEGER NOT NULL,
    "uploads" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_tokenHash_key" ON "GuestSession"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestSession_expiresAt_idx" ON "GuestSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Folder_ownerId_parentId_deletedAt_idx" ON "Folder"("ownerId", "parentId", "deletedAt");

-- CreateIndex
CREATE INDEX "Folder_trashBatchId_idx" ON "Folder"("trashBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "File_storageKey_key" ON "File"("storageKey");

-- CreateIndex
CREATE INDEX "File_ownerId_deletedAt_folderId_idx" ON "File"("ownerId", "deletedAt", "folderId");

-- CreateIndex
CREATE INDEX "File_ownerId_deletedAt_createdAt_idx" ON "File"("ownerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "File_ownerId_deletedAt_lastAccessedAt_idx" ON "File"("ownerId", "deletedAt", "lastAccessedAt");

-- CreateIndex
CREATE INDEX "File_guestSessionId_deletedAt_idx" ON "File"("guestSessionId", "deletedAt");

-- CreateIndex
CREATE INDEX "File_expiresAt_idx" ON "File"("expiresAt");

-- CreateIndex
CREATE INDEX "File_status_idx" ON "File"("status");

-- CreateIndex
CREATE INDEX "File_sha256_idx" ON "File"("sha256");

-- CreateIndex
CREATE INDEX "File_trashBatchId_idx" ON "File"("trashBatchId");

-- CreateIndex
CREATE INDEX "File_category_idx" ON "File"("category");

-- CreateIndex
CREATE INDEX "Upload_ownerId_status_idx" ON "Upload"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Upload_guestSessionId_status_idx" ON "Upload"("guestSessionId", "status");

-- CreateIndex
CREATE INDEX "Upload_sessionExpiresAt_idx" ON "Upload"("sessionExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadChunk_uploadId_index_key" ON "UploadChunk"("uploadId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_fileId_idx" ON "ShareLink"("fileId");

-- CreateIndex
CREATE INDEX "ShareLink_folderId_idx" ON "ShareLink"("folderId");

-- CreateIndex
CREATE INDEX "ShareLink_ownerId_createdAt_idx" ON "ShareLink"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ShareLink_guestSessionId_idx" ON "ShareLink"("guestSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "Download_fileId_createdAt_idx" ON "Download"("fileId", "createdAt");

-- CreateIndex
CREATE INDEX "Download_createdAt_idx" ON "Download"("createdAt");

-- CreateIndex
CREATE INDEX "AbuseReport_status_createdAt_idx" ON "AbuseReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AbuseReport_fileId_idx" ON "AbuseReport"("fileId");

-- CreateIndex
CREATE INDEX "VirusScan_fileId_idx" ON "VirusScan"("fileId");

-- CreateIndex
CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_fileId_key" ON "Favorite"("userId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_folderId_key" ON "Favorite"("userId", "folderId");

-- CreateIndex
CREATE INDEX "TrashItem_ownerId_deletedAt_idx" ON "TrashItem"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "TrashItem_purgeAt_idx" ON "TrashItem"("purgeAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_dedupeKey_idx" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");

-- CreateIndex
CREATE INDEX "ArchiveJob_ownerId_createdAt_idx" ON "ArchiveJob"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ArchiveJob_status_expiresAt_idx" ON "ArchiveJob"("status", "expiresAt");
