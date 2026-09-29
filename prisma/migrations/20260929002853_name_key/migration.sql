-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_File" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "guestSessionId" TEXT,
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
INSERT INTO "new_File" ("category", "createdAt", "deletedAt", "downloadCount", "expiresAt", "extension", "folderId", "guestSessionId", "id", "lastAccessedAt", "lastDownloadAt", "mime", "originalName", "ownerId", "quarantineNote", "safeName", "scanStatus", "sha256", "size", "status", "storageKey", "thumbnailKey", "trashBatchId", "updatedAt") SELECT "category", "createdAt", "deletedAt", "downloadCount", "expiresAt", "extension", "folderId", "guestSessionId", "id", "lastAccessedAt", "lastDownloadAt", "mime", "originalName", "ownerId", "quarantineNote", "safeName", "scanStatus", "sha256", "size", "status", "storageKey", "thumbnailKey", "trashBatchId", "updatedAt" FROM "File";
DROP TABLE "File";
ALTER TABLE "new_File" RENAME TO "File";
CREATE UNIQUE INDEX "File_storageKey_key" ON "File"("storageKey");
CREATE INDEX "File_ownerId_deletedAt_folderId_idx" ON "File"("ownerId", "deletedAt", "folderId");
CREATE INDEX "File_ownerId_deletedAt_createdAt_idx" ON "File"("ownerId", "deletedAt", "createdAt");
CREATE INDEX "File_ownerId_deletedAt_lastAccessedAt_idx" ON "File"("ownerId", "deletedAt", "lastAccessedAt");
CREATE INDEX "File_guestSessionId_deletedAt_idx" ON "File"("guestSessionId", "deletedAt");
CREATE INDEX "File_expiresAt_idx" ON "File"("expiresAt");
CREATE INDEX "File_status_idx" ON "File"("status");
CREATE INDEX "File_sha256_idx" ON "File"("sha256");
CREATE INDEX "File_trashBatchId_idx" ON "File"("trashBatchId");
CREATE INDEX "File_category_idx" ON "File"("category");
CREATE TABLE "new_Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "trashBatchId" TEXT,
    CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Folder" ("createdAt", "deletedAt", "id", "name", "ownerId", "parentId", "trashBatchId", "updatedAt") SELECT "createdAt", "deletedAt", "id", "name", "ownerId", "parentId", "trashBatchId", "updatedAt" FROM "Folder";
DROP TABLE "Folder";
ALTER TABLE "new_Folder" RENAME TO "Folder";
CREATE INDEX "Folder_ownerId_parentId_deletedAt_idx" ON "Folder"("ownerId", "parentId", "deletedAt");
CREATE INDEX "Folder_trashBatchId_idx" ON "Folder"("trashBatchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
