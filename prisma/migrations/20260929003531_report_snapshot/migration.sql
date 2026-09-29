-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AbuseReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT,
    "fileName" TEXT NOT NULL DEFAULT '',
    "fileOwnerId" TEXT,
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
    CONSTRAINT "AbuseReport_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AbuseReport_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ShareLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AbuseReport" ("category", "contact", "createdAt", "description", "fileId", "id", "reporterKey", "resolutionNote", "resolvedAt", "resolvedById", "shareId", "status") SELECT "category", "contact", "createdAt", "description", "fileId", "id", "reporterKey", "resolutionNote", "resolvedAt", "resolvedById", "shareId", "status" FROM "AbuseReport";
DROP TABLE "AbuseReport";
ALTER TABLE "new_AbuseReport" RENAME TO "AbuseReport";
CREATE INDEX "AbuseReport_status_createdAt_idx" ON "AbuseReport"("status", "createdAt");
CREATE INDEX "AbuseReport_fileId_idx" ON "AbuseReport"("fileId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
