import { db } from "../db";
import type { FileDto, UsageDto } from "@/lib/types";
import { scopeOf, scopeWhere, type Actor } from "./actor";
import { workspaceActivity, type ActivityDto } from "./activity";
import { activeShareWhere, fileInclude } from "./files";
import { usageFor } from "./limits";
import { serializeFile } from "./serializers";

export interface DashboardData {
  usage: UsageDto;
  fileCount: number;
  folderCount: number;
  downloadCount: number;
  activeShares: number;
  trash: { items: number; bytes: number };
  recentFiles: FileDto[];
  activity: ActivityDto[];
}

/** Numbers and lists for the workspace the actor is currently in. Everything is computed from real rows. */
export async function dashboardFor(actor: Actor): Promise<DashboardData> {
  const scope = scopeOf(actor);
  const where = scopeWhere(scope);
  const [usage, fileCount, folderCount, downloads, activeShares, trash, recent, activity] = await Promise.all([
    usageFor(actor),
    db.file.count({ where: { ...where, deletedAt: null } }),
    db.folder.count({ where: { ...where, deletedAt: null } }),
    db.file.aggregate({ where, _sum: { downloadCount: true } }),
    db.shareLink.count({ where: { ...(scope.orgId ? { OR: [{ file: { orgId: scope.orgId } }, { folder: { orgId: scope.orgId } }] } : { ownerId: scope.userId }), ...activeShareWhere() } }),
    db.trashItem.aggregate({ where: scope.orgId ? { orgId: scope.orgId } : { ownerId: scope.userId, orgId: null }, _count: true, _sum: { size: true } }),
    db.file.findMany({ where: { ...where, deletedAt: null, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 8, include: fileInclude(actor) }),
    workspaceActivity(actor, { limit: 12 }),
  ]);
  return {
    usage,
    fileCount,
    folderCount,
    downloadCount: downloads._sum?.downloadCount ?? 0,
    activeShares,
    trash: { items: trash._count, bytes: Number(trash._sum?.size ?? 0n) },
    recentFiles: recent.map((f) => serializeFile(f)),
    activity: activity.items,
  };
}
