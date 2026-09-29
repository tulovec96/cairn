import { db } from "../db";
import { Errors } from "../errors";
import { parseJson } from "./serializers";
import { ownerWhere, scopeOf, workspaceIdOf, type Actor } from "./actor";

export interface ActivityDto {
  id: string;
  action: string;
  actor: string | null;
  fileId: string | null;
  folderId: string | null;
  targetName: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const toDto = (a: { id: string; action: string; actorLabel: string | null; fileId: string | null; folderId: string | null; targetName: string; metadata: string; createdAt: Date }): ActivityDto => ({
  id: a.id,
  action: a.action,
  actor: a.actorLabel,
  fileId: a.fileId,
  folderId: a.folderId,
  targetName: a.targetName,
  metadata: parseJson<Record<string, unknown>>(a.metadata, {}),
  createdAt: a.createdAt.toISOString(),
});

export async function fileActivity(actor: Actor, fileId: string, limit = 50): Promise<ActivityDto[]> {
  const file = await db.file.findFirst({ where: { id: fileId, ...ownerWhere(actor) }, select: { id: true } });
  if (!file) throw Errors.notFound();
  return (await db.activityEvent.findMany({ where: { fileId }, orderBy: { createdAt: "desc" }, take: limit })).map(toDto);
}

export async function workspaceActivity(actor: Actor, opts: { cursor?: string; limit?: number; action?: string } = {}): Promise<{ items: ActivityDto[]; nextCursor: string | null }> {
  const limit = Math.min(100, opts.limit ?? 50);
  const rows = await db.activityEvent.findMany({
    where: { workspaceId: workspaceIdOf(scopeOf(actor)), ...(opts.action ? { action: opts.action } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  return { items: page.map(toDto), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}
