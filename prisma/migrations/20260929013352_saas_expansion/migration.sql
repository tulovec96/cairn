-- Guest accounts were removed: uploads now always belong to an authenticated account.
-- Remove any rows that only existed for guest sessions before ownerId becomes required.
-- (Their blobs, if any, are reclaimed by the storage garbage-collection job.)
DELETE FROM "Download" WHERE "fileId" IN (SELECT "id" FROM "File" WHERE "ownerId" IS NULL);
DELETE FROM "VirusScan" WHERE "fileId" IN (SELECT "id" FROM "File" WHERE "ownerId" IS NULL);
DELETE FROM "Favorite" WHERE "fileId" IN (SELECT "id" FROM "File" WHERE "ownerId" IS NULL);
DELETE FROM "AbuseReport" WHERE "fileId" IN (SELECT "id" FROM "File" WHERE "ownerId" IS NULL);
DELETE FROM "ShareLink" WHERE "ownerId" IS NULL OR "fileId" IN (SELECT "id" FROM "File" WHERE "ownerId" IS NULL);
DELETE FROM "UploadChunk" WHERE "uploadId" IN (SELECT "id" FROM "Upload" WHERE "ownerId" IS NULL);
DELETE FROM "Upload" WHERE "ownerId" IS NULL;
DELETE FROM "ArchiveJob" WHERE "ownerId" IS NULL;
DELETE FROM "File" WHERE "ownerId" IS NULL;
/*
  Warnings:

  - You are about to drop the `GuestSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `guestSessionId` on the `ArchiveJob` table. All the data in the column will be lost.
  - You are about to drop the column `guestSessionId` on the `File` table. All the data in the column will be lost.
  - You are about to drop the column `guestSessionId` on the `ShareLink` table. All the data in the column will be lost.
  - You are about to drop the column `guestFiles` on the `StatSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `guestSessionId` on the `Upload` table. All the data in the column will be lost.
  - Made the column `ownerId` on table `ArchiveJob` required. This step will fail if there are existing NULL values in that column.
  - Made the column `ownerId` on table `File` required. This step will fail if there are existing NULL values in that column.
  - Made the column `ownerId` on table `ShareLink` required. This step will fail if there are existing NULL values in that column.
  - Made the column `ownerId` on table `Upload` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "GuestSession_expiresAt_idx";

-- DropIndex
DROP INDEX "GuestSession_tokenHash_key";

-- DropIndex
DROP INDEX "TrashItem_ownerId_deletedAt_idx";

-- AlterTable
ALTER TABLE "Download" ADD COLUMN "bytes" BIGINT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "deviceLabel" TEXT;

-- AlterTable
ALTER TABLE "TrashItem" ADD COLUMN "orgId" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "GuestSession";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "toEmail" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL DEFAULT 'none',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);

-- CreateTable
CREATE TABLE "ApiUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Plan" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceMonthlyCents" INTEGER NOT NULL DEFAULT 0,
    "priceYearlyCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "features" TEXT NOT NULL DEFAULT '{}',
    "limits" TEXT NOT NULL DEFAULT '{}',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "providerPrices" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "orgId" TEXT,
    "planKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "interval" TEXT NOT NULL DEFAULT 'month',
    "currentPeriodStart" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" DATETIME,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" DATETIME,
    "provider" TEXT NOT NULL DEFAULT 'internal',
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Subscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT,
    "userId" TEXT,
    "orgId" TEXT,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER,
    "currency" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'internal',
    "providerEventId" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL DEFAULT 'free',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "invitedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizationInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationInvite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FolderMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolderMember_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FolderMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7691',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileTag" (
    "fileId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("fileId", "tagId"),
    CONSTRAINT "FileTag_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT,
    "folderId" TEXT,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "mentions" TEXT NOT NULL DEFAULT '[]',
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "fileId" TEXT,
    "folderId" TEXT,
    "targetName" TEXT NOT NULL DEFAULT '',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityEvent_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "orgId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'request',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "token" TEXT NOT NULL,
    "folderId" TEXT,
    "expiresAt" DATETIME,
    "closedAt" DATETIME,
    "maxFileBytes" BIGINT,
    "maxFiles" INTEGER,
    "maxTotalBytes" BIGINT,
    "allowedExtensions" TEXT NOT NULL DEFAULT '[]',
    "passwordHash" TEXT,
    "notifyOnUpload" BOOLEAN NOT NULL DEFAULT true,
    "uploadCount" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "brandName" TEXT,
    "accent" TEXT,
    "welcomeMessage" TEXT,
    "logoKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FileRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileRequest_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bytes" BIGINT,
    "referrer" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareEvent_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ShareLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuarantineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "signature" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuarantineItem_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Webhook_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "webhookId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responseCode" INTEGER,
    "responseBody" TEXT,
    "latencyMs" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME,
    CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actions" TEXT NOT NULL,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Automation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "automationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fileId" TEXT,
    "detail" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "folderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "fileId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ImportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "storageKey" TEXT,
    "size" BIGINT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "DataExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BackupRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "path" TEXT,
    "size" BIGINT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Changelog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT,
    "publishedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "StatusCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "service" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'investigating',
    "severity" TEXT NOT NULL DEFAULT 'minor',
    "services" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AbuseReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL DEFAULT 'file',
    "targetId" TEXT,
    "fileId" TEXT,
    "fileName" TEXT NOT NULL DEFAULT '',
    "fileOwnerId" TEXT,
    "shareId" TEXT,
    "reporterUserId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "contact" TEXT,
    "reporterKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "AbuseReport_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AbuseReport_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ShareLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AbuseReport" ("category", "contact", "createdAt", "description", "fileId", "fileName", "fileOwnerId", "id", "reporterKey", "resolutionNote", "resolvedAt", "resolvedById", "shareId", "status") SELECT "category", "contact", "createdAt", "description", "fileId", "fileName", "fileOwnerId", "id", "reporterKey", "resolutionNote", "resolvedAt", "resolvedById", "shareId", "status" FROM "AbuseReport";
DROP TABLE "AbuseReport";
ALTER TABLE "new_AbuseReport" RENAME TO "AbuseReport";
CREATE INDEX "AbuseReport_status_createdAt_idx" ON "AbuseReport"("status", "createdAt");
CREATE INDEX "AbuseReport_fileId_idx" ON "AbuseReport"("fileId");
CREATE TABLE "new_ArchiveJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
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
    CONSTRAINT "ArchiveJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ArchiveJob" ("createdAt", "error", "expiresAt", "id", "items", "name", "ownerId", "processedBytes", "processedFiles", "size", "status", "storageKey", "totalBytes", "totalFiles", "updatedAt") SELECT "createdAt", "error", "expiresAt", "id", "items", "name", "ownerId", "processedBytes", "processedFiles", "size", "status", "storageKey", "totalBytes", "totalFiles", "updatedAt" FROM "ArchiveJob";
DROP TABLE "ArchiveJob";
ALTER TABLE "new_ArchiveJob" RENAME TO "ArchiveJob";
CREATE INDEX "ArchiveJob_ownerId_createdAt_idx" ON "ArchiveJob"("ownerId", "createdAt");
CREATE INDEX "ArchiveJob_status_expiresAt_idx" ON "ArchiveJob"("status", "expiresAt");
CREATE TABLE "new_File" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "orgId" TEXT,
    "folderId" TEXT,
    "originalName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL DEFAULT '',
    "safeName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "size" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "sha256" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "colorLabel" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "mediaInfo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "quarantineNote" TEXT,
    "requestId" TEXT,
    "uploaderLabel" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadAt" DATETIME,
    "lastAccessedAt" DATETIME,
    "expiresAt" DATETIME,
    "archivedAt" DATETIME,
    "deletedAt" DATETIME,
    "trashBatchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "File_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "File_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "File_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_File" ("category", "createdAt", "deletedAt", "downloadCount", "expiresAt", "extension", "folderId", "id", "lastAccessedAt", "lastDownloadAt", "mime", "nameKey", "originalName", "ownerId", "quarantineNote", "safeName", "scanStatus", "sha256", "size", "status", "storageKey", "thumbnailKey", "trashBatchId", "updatedAt") SELECT "category", "createdAt", "deletedAt", "downloadCount", "expiresAt", "extension", "folderId", "id", "lastAccessedAt", "lastDownloadAt", "mime", "nameKey", "originalName", "ownerId", "quarantineNote", "safeName", "scanStatus", "sha256", "size", "status", "storageKey", "thumbnailKey", "trashBatchId", "updatedAt" FROM "File";
DROP TABLE "File";
ALTER TABLE "new_File" RENAME TO "File";
CREATE UNIQUE INDEX "File_storageKey_key" ON "File"("storageKey");
CREATE INDEX "File_ownerId_orgId_deletedAt_folderId_idx" ON "File"("ownerId", "orgId", "deletedAt", "folderId");
CREATE INDEX "File_ownerId_orgId_deletedAt_createdAt_idx" ON "File"("ownerId", "orgId", "deletedAt", "createdAt");
CREATE INDEX "File_ownerId_orgId_deletedAt_lastAccessedAt_idx" ON "File"("ownerId", "orgId", "deletedAt", "lastAccessedAt");
CREATE INDEX "File_orgId_deletedAt_folderId_idx" ON "File"("orgId", "deletedAt", "folderId");
CREATE INDEX "File_expiresAt_idx" ON "File"("expiresAt");
CREATE INDEX "File_status_idx" ON "File"("status");
CREATE INDEX "File_sha256_idx" ON "File"("sha256");
CREATE INDEX "File_trashBatchId_idx" ON "File"("trashBatchId");
CREATE INDEX "File_category_idx" ON "File"("category");
CREATE INDEX "File_requestId_idx" ON "File"("requestId");
CREATE TABLE "new_Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "orgId" TEXT,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME,
    "deletedAt" DATETIME,
    "trashBatchId" TEXT,
    CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Folder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Folder" ("createdAt", "deletedAt", "id", "name", "nameKey", "ownerId", "parentId", "trashBatchId", "updatedAt") SELECT "createdAt", "deletedAt", "id", "name", "nameKey", "ownerId", "parentId", "trashBatchId", "updatedAt" FROM "Folder";
DROP TABLE "Folder";
ALTER TABLE "new_Folder" RENAME TO "Folder";
CREATE INDEX "Folder_ownerId_orgId_parentId_deletedAt_idx" ON "Folder"("ownerId", "orgId", "parentId", "deletedAt");
CREATE INDEX "Folder_orgId_parentId_deletedAt_idx" ON "Folder"("orgId", "parentId", "deletedAt");
CREATE INDEX "Folder_trashBatchId_idx" ON "Folder"("trashBatchId");
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT,
    "lastError" TEXT,
    "userId" TEXT,
    "lockedAt" DATETIME,
    "startedAt" DATETIME,
    "dedupeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);
INSERT INTO "new_Job" ("attempts", "createdAt", "dedupeKey", "finishedAt", "id", "lastError", "lockedAt", "maxAttempts", "payload", "runAt", "status", "type") SELECT "attempts", "createdAt", "dedupeKey", "finishedAt", "id", "lastError", "lockedAt", "maxAttempts", "payload", "runAt", "status", "type" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");
CREATE TABLE "new_ShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "fileId" TEXT,
    "folderId" TEXT,
    "ownerId" TEXT NOT NULL,
    "passwordHash" TEXT,
    "permissions" TEXT NOT NULL DEFAULT 'view,download',
    "title" TEXT,
    "message" TEXT,
    "expiresAt" DATETIME,
    "maxDownloads" INTEGER,
    "maxViews" INTEGER,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "ipAllowlist" TEXT,
    "showSha256" BOOLEAN NOT NULL DEFAULT true,
    "embedEnabled" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" DATETIME,
    "lastAccessedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShareLink_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareLink_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareLink_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ShareLink" ("createdAt", "downloadCount", "expiresAt", "fileId", "folderId", "id", "lastAccessedAt", "maxDownloads", "ownerId", "passwordHash", "revokedAt", "showSha256", "token", "updatedAt") SELECT "createdAt", "downloadCount", "expiresAt", "fileId", "folderId", "id", "lastAccessedAt", "maxDownloads", "ownerId", "passwordHash", "revokedAt", "showSha256", "token", "updatedAt" FROM "ShareLink";
DROP TABLE "ShareLink";
ALTER TABLE "new_ShareLink" RENAME TO "ShareLink";
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");
CREATE INDEX "ShareLink_fileId_idx" ON "ShareLink"("fileId");
CREATE INDEX "ShareLink_folderId_idx" ON "ShareLink"("folderId");
CREATE INDEX "ShareLink_ownerId_createdAt_idx" ON "ShareLink"("ownerId", "createdAt");
CREATE TABLE "new_StatSnapshot" (
    "day" TEXT NOT NULL PRIMARY KEY,
    "users" INTEGER NOT NULL,
    "files" INTEGER NOT NULL,
    "storageBytes" BIGINT NOT NULL,
    "downloads" INTEGER NOT NULL,
    "uploads" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_StatSnapshot" ("createdAt", "day", "downloads", "files", "storageBytes", "uploads", "users") SELECT "createdAt", "day", "downloads", "files", "storageBytes", "uploads", "users" FROM "StatSnapshot";
DROP TABLE "StatSnapshot";
ALTER TABLE "new_StatSnapshot" RENAME TO "StatSnapshot";
CREATE TABLE "new_Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "orgId" TEXT,
    "folderId" TEXT,
    "requestId" TEXT,
    "uploadKeyHash" TEXT,
    "uploaderLabel" TEXT,
    "replaceFileId" TEXT,
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
    CONSTRAINT "Upload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Upload" ("chunkSize", "createdAt", "declaredMime", "error", "expectedSha256", "expiresAt", "fileId", "fileName", "folderId", "id", "maxDownloads", "ownerId", "sessionExpiresAt", "share", "sharePasswordHash", "size", "stagingPath", "status", "totalChunks", "updatedAt") SELECT "chunkSize", "createdAt", "declaredMime", "error", "expectedSha256", "expiresAt", "fileId", "fileName", "folderId", "id", "maxDownloads", "ownerId", "sessionExpiresAt", "share", "sharePasswordHash", "size", "stagingPath", "status", "totalChunks", "updatedAt" FROM "Upload";
DROP TABLE "Upload";
ALTER TABLE "new_Upload" RENAME TO "Upload";
CREATE INDEX "Upload_ownerId_status_idx" ON "Upload"("ownerId", "status");
CREATE INDEX "Upload_sessionExpiresAt_idx" ON "Upload"("sessionExpiresAt");
CREATE INDEX "Upload_requestId_idx" ON "Upload"("requestId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "suspendedReason" TEXT,
    "quotaBytes" BIGINT,
    "maxFileBytes" BIGINT,
    "planKey" TEXT NOT NULL DEFAULT 'free',
    "avatarKey" TEXT,
    "bio" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "language" TEXT NOT NULL DEFAULT 'en',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "prefs" TEXT NOT NULL DEFAULT '{}',
    "privacy" TEXT NOT NULL DEFAULT '{}',
    "emailVerifiedAt" DATETIME,
    "totpSecret" TEXT,
    "totpEnabledAt" DATETIME,
    "backupCodes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME
);
INSERT INTO "new_User" ("createdAt", "displayName", "email", "id", "lastLoginAt", "maxFileBytes", "passwordHash", "quotaBytes", "role", "status", "suspendedReason", "updatedAt") SELECT "createdAt", "displayName", "email", "id", "lastLoginAt", "maxFileBytes", "passwordHash", "quotaBytes", "role", "status", "suspendedReason", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_status_idx" ON "User"("status");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "User_planKey_idx" ON "User"("planKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

-- CreateIndex
CREATE INDEX "EmailMessage_status_createdAt_idx" ON "EmailMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_userId_idx" ON "EmailMessage"("userId");

-- CreateIndex
CREATE INDEX "ApiUsage_userId_createdAt_idx" ON "ApiUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiUsage_createdAt_idx" ON "ApiUsage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerSubscriptionId_key" ON "Subscription"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- CreateIndex
CREATE INDEX "Subscription_orgId_status_idx" ON "Subscription"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_providerEventId_key" ON "BillingEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "BillingEvent_userId_createdAt_idx" ON "BillingEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingEvent_orgId_createdAt_idx" ON "BillingEvent"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_subjectType_subjectId_period_metric_key" ON "UsageCounter"("subjectType", "subjectId", "period", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_ownerId_idx" ON "Organization"("ownerId");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_orgId_userId_key" ON "OrganizationMember"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationInvite_tokenHash_key" ON "OrganizationInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "OrganizationInvite_orgId_idx" ON "OrganizationInvite"("orgId");

-- CreateIndex
CREATE INDEX "OrganizationInvite_email_idx" ON "OrganizationInvite"("email");

-- CreateIndex
CREATE INDEX "FolderMember_userId_idx" ON "FolderMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FolderMember_folderId_userId_key" ON "FolderMember"("folderId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_storageKey_key" ON "FileVersion"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_fileId_version_key" ON "FileVersion"("fileId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_workspaceId_nameKey_key" ON "Tag"("workspaceId", "nameKey");

-- CreateIndex
CREATE INDEX "FileTag_tagId_idx" ON "FileTag"("tagId");

-- CreateIndex
CREATE INDEX "SavedSearch_userId_pinned_idx" ON "SavedSearch"("userId", "pinned");

-- CreateIndex
CREATE INDEX "Comment_fileId_createdAt_idx" ON "Comment"("fileId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_folderId_createdAt_idx" ON "Comment"("folderId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_workspaceId_createdAt_idx" ON "ActivityEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_fileId_createdAt_idx" ON "ActivityEvent"("fileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FileRequest_token_key" ON "FileRequest"("token");

-- CreateIndex
CREATE INDEX "FileRequest_ownerId_closedAt_idx" ON "FileRequest"("ownerId", "closedAt");

-- CreateIndex
CREATE INDEX "FileRequest_orgId_idx" ON "FileRequest"("orgId");

-- CreateIndex
CREATE INDEX "ShareEvent_shareId_createdAt_idx" ON "ShareEvent"("shareId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuarantineItem_fileId_key" ON "QuarantineItem"("fileId");

-- CreateIndex
CREATE INDEX "QuarantineItem_state_createdAt_idx" ON "QuarantineItem"("state", "createdAt");

-- CreateIndex
CREATE INDEX "Webhook_ownerId_idx" ON "Webhook"("ownerId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_createdAt_idx" ON "WebhookDelivery"("webhookId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Automation_ownerId_enabled_idx" ON "Automation"("ownerId", "enabled");

-- CreateIndex
CREATE INDEX "AutomationRun_automationId_createdAt_idx" ON "AutomationRun"("automationId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_userId_createdAt_idx" ON "ImportJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DataExport_userId_createdAt_idx" ON "DataExport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BackupRecord_kind_createdAt_idx" ON "BackupRecord"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_updatedAt_idx" ON "SupportTicket"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "Changelog_publishedAt_idx" ON "Changelog"("publishedAt");

-- CreateIndex
CREATE INDEX "StatusCheck_service_createdAt_idx" ON "StatusCheck"("service", "createdAt");

-- CreateIndex
CREATE INDEX "Incident_createdAt_idx" ON "Incident"("createdAt");

-- CreateIndex
CREATE INDEX "TrashItem_ownerId_orgId_deletedAt_idx" ON "TrashItem"("ownerId", "orgId", "deletedAt");
