import { z } from "zod";
import { db } from "../db";
import { Errors } from "../errors";
import { newId } from "../ids";
import { assertFlag } from "./flags";
import { ownerWhere, type Actor } from "./actor";
import { assertFeature, entitlementsForActor } from "./limits";
import { notify } from "./notifications";
import { assertCan } from "./permissions";
import { parseJson } from "./serializers";

export interface CommentDto {
  id: string;
  parentId: string | null;
  author: { id: string; name: string } | null;
  body: string;
  mentions: string[];
  edited: boolean;
  deleted: boolean;
  createdAt: string;
  mine: boolean;
}

export const commentSchema = z.object({ body: z.string().trim().min(1, "Write something first.").max(4000), parentId: z.string().max(40).optional() });

async function target(actor: Actor, fileId: string) {
  const file = await db.file.findFirst({ where: { id: fileId, ...ownerWhere(actor), deletedAt: null }, select: { id: true, originalName: true, orgId: true, ownerId: true } });
  if (!file) throw Errors.notFound();
  return file;
}

async function gate(actor: Actor) {
  await assertFlag("comments");
  await assertFeature(await entitlementsForActor(actor), "comments");
}

const toDto = (c: { id: string; parentId: string | null; body: string; mentions: string; editedAt: Date | null; deletedAt: Date | null; createdAt: Date; authorId: string; author: { id: string; displayName: string } }, me: string): CommentDto => ({
  id: c.id,
  parentId: c.parentId,
  author: c.deletedAt ? null : { id: c.author.id, name: c.author.displayName },
  body: c.deletedAt ? "" : c.body,
  mentions: parseJson<string[]>(c.mentions, []),
  edited: !!c.editedAt,
  deleted: !!c.deletedAt,
  createdAt: c.createdAt.toISOString(),
  mine: c.authorId === me,
});

export async function listComments(actor: Actor, fileId: string): Promise<CommentDto[]> {
  await gate(actor);
  await target(actor, fileId);
  const rows = await db.comment.findMany({ where: { fileId }, orderBy: { createdAt: "asc" }, take: 500, include: { author: { select: { id: true, displayName: true } } } });
  // Deleted comments that still have replies stay as a placeholder so threads keep their shape.
  const withReplies = new Set(rows.filter((r) => r.parentId).map((r) => r.parentId));
  return rows.filter((r) => !r.deletedAt || withReplies.has(r.id)).map((r) => toDto(r, actor.user.id));
}

/** @handle mentions resolve against members of the same workspace (or the owner, for personal files). */
async function resolveMentions(actor: Actor, orgId: string | null, body: string): Promise<string[]> {
  const handles = [...new Set([...body.matchAll(/@([a-zA-Z0-9._-]{2,40})/g)].map((m) => m[1].toLowerCase()))].slice(0, 10);
  if (!handles.length) return [];
  const users = await db.user.findMany({
    where: {
      OR: [{ username: { in: handles } }, ...handles.map((h) => ({ email: { startsWith: `${h}@` } }))],
      ...(orgId ? { memberships: { some: { orgId } } } : { id: actor.user.id }),
    },
    select: { id: true },
    take: 10,
  });
  return users.map((u) => u.id).filter((id) => id !== actor.user.id);
}

export async function addComment(actor: Actor, fileId: string, input: z.infer<typeof commentSchema>): Promise<CommentDto> {
  await gate(actor);
  assertCan(actor, "comment");
  const file = await target(actor, fileId);
  if (input.parentId) {
    const parent = await db.comment.findFirst({ where: { id: input.parentId, fileId, parentId: null } });
    if (!parent) throw Errors.notFound("The comment you're replying to no longer exists.");
  }
  const mentions = await resolveMentions(actor, file.orgId, input.body);
  const row = await db.comment.create({
    data: { id: newId("cmt"), fileId, authorId: actor.user.id, parentId: input.parentId ?? null, body: input.body, mentions: JSON.stringify(mentions) },
    include: { author: { select: { id: true, displayName: true } } },
  });
  for (const userId of mentions) {
    await notify({ userId, type: "comment_mention", title: `${actor.user.displayName} mentioned you`, body: `On ${file.originalName}: ${input.body.slice(0, 140)}`, href: `/file/${fileId}` });
  }
  return toDto(row, actor.user.id);
}

export async function editComment(actor: Actor, commentId: string, body: string): Promise<CommentDto> {
  await gate(actor);
  const c = await db.comment.findFirst({ where: { id: commentId, authorId: actor.user.id, deletedAt: null } });
  if (!c) throw Errors.notFound("You can only edit your own comments.");
  if (c.fileId) await target(actor, c.fileId);
  const row = await db.comment.update({ where: { id: commentId }, data: { body, editedAt: new Date() }, include: { author: { select: { id: true, displayName: true } } } });
  return toDto(row, actor.user.id);
}

export async function deleteComment(actor: Actor, commentId: string): Promise<void> {
  await gate(actor);
  const c = await db.comment.findUnique({ where: { id: commentId } });
  if (!c?.fileId) throw Errors.notFound();
  const file = await target(actor, c.fileId);
  const canModerate = actor.workspace.role === "owner" || actor.workspace.role === "admin" || file.ownerId === actor.user.id;
  if (c.authorId !== actor.user.id && !canModerate) throw Errors.forbidden("You can only delete your own comments.");
  await db.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
}
