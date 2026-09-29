import { z } from "zod";
import type { File as FileRow } from "@prisma/client";
import { db } from "../db";
import { Errors } from "../errors";
import { newId } from "../ids";
import * as rate from "../ratelimit";
import { previewKind, type FileCategory } from "@/lib/fileTypes";
import { scopeOf, type Actor } from "./actor";
import { audit } from "./audit";
import { emailSchema } from "./auth";
import { getOwnedFolder } from "./folders";
import { notify } from "./notifications";
import { parseJson } from "./serializers";
import type { MediaInfo } from "@/lib/types";

/**
 * Sharing a folder with other accounts (view-only). It is separate from share links and from organizations:
 * a member can browse, preview and download what's inside the folder and its subfolders, and nothing else.
 * They can't change anything, see the owner's other files, or re-share. Access is re-checked on every
 * request by walking up from the folder being read to a folder they were added to.
 */

const MAX_MEMBERS_PER_FOLDER = 50;
const MAX_DEPTH = 32;

export const memberSchema = z.object({ email: emailSchema });

export interface FolderMemberDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  addedAt: string;
}

export interface SharedFolderDto {
  membershipId: string;
  folderId: string;
  name: string;
  ownerName: string;
  sharedAt: string;
}

export interface SharedFileDto {
  id: string;
  name: string;
  size: number;
  mime: string;
  extension: string;
  category: FileCategory;
  previewKind: ReturnType<typeof previewKind>;
  hasThumbnail: boolean;
  sha256: string;
  createdAt: string;
  mediaInfo: MediaInfo | null;
}

// ---- Owner side --------------------------------------------------------------------------------

/** Only folders in the caller's personal files can be shared with people. Organizations use member roles instead. */
async function ownFolderForSharing(actor: Actor, folderId: string) {
  if (actor.workspace.orgId) throw Errors.conflict("Folders in an organization are shared through the organization's members. Switch to your personal files to share a folder with people.");
  return getOwnedFolder(scopeOf(actor), folderId);
}

async function memberList(folderId: string): Promise<FolderMemberDto[]> {
  const rows = await db.folderMember.findMany({ where: { folderId }, include: { user: { select: { id: true, displayName: true, email: true } } }, orderBy: { createdAt: "asc" } });
  return rows.map((m) => ({ id: m.id, userId: m.user.id, name: m.user.displayName, email: m.user.email, addedAt: m.createdAt.toISOString() }));
}

export async function listFolderMembers(actor: Actor, folderId: string): Promise<FolderMemberDto[]> {
  await ownFolderForSharing(actor, folderId);
  return memberList(folderId);
}

/**
 * Adds a person by email. The answer is the same whether or not an account exists for that address, so this
 * can't be used to find out who has an account. People who do have one are notified.
 */
export async function addFolderMember(actor: Actor, folderId: string, email: string, ip?: string): Promise<{ members: FolderMemberDto[]; note: string }> {
  const folder = await ownFolderForSharing(actor, folderId);
  rate.enforce(`folder-share:${actor.user.id}`, { limit: 40, windowSec: 3600 }, "You've shared with many people recently. Try again later.");
  const existing = await db.folderMember.count({ where: { folderId } });
  if (existing >= MAX_MEMBERS_PER_FOLDER) throw Errors.conflict(`A folder can be shared with up to ${MAX_MEMBERS_PER_FOLDER} people.`);
  const target = await db.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, status: true } });
  if (target && target.id !== actor.user.id && target.status === "active") {
    const already = await db.folderMember.findUnique({ where: { folderId_userId: { folderId, userId: target.id } } });
    if (!already) {
      await db.folderMember.create({ data: { id: newId("fmb"), folderId, userId: target.id, permission: "view", addedById: actor.user.id } });
      await notify({ userId: target.id, type: "folder_shared", title: `${actor.user.displayName} shared “${folder.name}” with you`, body: "You can view and download what's inside.", href: `/shared-with-me?folder=${folder.id}` });
      await audit({ actorType: "user", actorId: actor.user.id, action: "folder.member_added", targetType: "folder", targetId: folderId, ip, metadata: { memberId: target.id } });
    }
  }
  return { members: await memberList(folderId), note: "If that address belongs to an account, the folder is now shared with them." };
}

/** The owner removes someone, or a member removes themselves (leaving the share). */
export async function removeFolderMember(actor: Actor, folderId: string, memberId: string, ip?: string): Promise<void> {
  const member = await db.folderMember.findFirst({ where: { id: memberId, folderId }, include: { folder: { select: { ownerId: true, orgId: true } } } });
  if (!member) throw Errors.notFound("That person doesn't have access to this folder.");
  const isOwner = member.folder.ownerId === actor.user.id && !member.folder.orgId;
  const isSelf = member.userId === actor.user.id;
  if (!isOwner && !isSelf) throw Errors.notFound("That person doesn't have access to this folder.");
  await db.folderMember.delete({ where: { id: memberId } });
  await audit({ actorType: "user", actorId: actor.user.id, action: "folder.member_removed", targetType: "folder", targetId: folderId, ip, metadata: { memberId: member.userId, self: isSelf } });
}

// ---- Member side -------------------------------------------------------------------------------

export async function listSharedWithMe(actor: Actor): Promise<SharedFolderDto[]> {
  const rows = await db.folderMember.findMany({
    where: { userId: actor.user.id, folder: { deletedAt: null } },
    include: { folder: { select: { id: true, name: true, owner: { select: { displayName: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((m) => ({ membershipId: m.id, folderId: m.folder.id, name: m.folder.name, ownerName: m.folder.owner.displayName, sharedAt: m.createdAt.toISOString() }));
}

/**
 * Finds the folder the caller was added to that contains `folderId`, walking up through non-deleted folders.
 * Returns the path from that shared root down to `folderId`. Throws 404 (never 403) when there is none.
 */
async function resolveAccess(actor: Actor, folderId: string): Promise<{ rootId: string; path: Array<{ id: string; name: string }> }> {
  const notFound = () => Errors.notFound("That folder isn't shared with you.");
  const chain: Array<{ id: string; name: string; parentId: string | null }> = [];
  let cursor: string | null = folderId;
  for (let i = 0; cursor && i < MAX_DEPTH; i++) {
    const f: { id: string; name: string; parentId: string | null; deletedAt: Date | null } | null = await db.folder.findUnique({ where: { id: cursor }, select: { id: true, name: true, parentId: true, deletedAt: true } });
    if (!f || f.deletedAt) throw notFound();
    chain.push({ id: f.id, name: f.name, parentId: f.parentId });
    cursor = f.parentId;
  }
  const membership = await db.folderMember.findFirst({ where: { userId: actor.user.id, folderId: { in: chain.map((c) => c.id) } }, select: { folderId: true } });
  if (!membership) throw notFound();
  const at = chain.findIndex((c) => c.id === membership.folderId);
  return { rootId: membership.folderId, path: chain.slice(0, at + 1).reverse().map(({ id, name }) => ({ id, name })) };
}

const toFileDto = (f: Pick<FileRow, "id" | "originalName" | "size" | "mime" | "extension" | "category" | "thumbnailKey" | "sha256" | "createdAt" | "mediaInfo">): SharedFileDto => ({
  id: f.id,
  name: f.originalName,
  size: Number(f.size),
  mime: f.mime,
  extension: f.extension,
  category: f.category as FileCategory,
  previewKind: previewKind(f.mime, f.extension),
  hasThumbnail: !!f.thumbnailKey,
  sha256: f.sha256,
  createdAt: f.createdAt.toISOString(),
  mediaInfo: parseJson<MediaInfo | null>(f.mediaInfo, null),
});

export async function browseSharedFolder(actor: Actor, folderId: string) {
  const { rootId, path } = await resolveAccess(actor, folderId);
  const [folders, files, owner] = await Promise.all([
    db.folder.findMany({ where: { parentId: folderId, deletedAt: null, archivedAt: null }, select: { id: true, name: true }, orderBy: { nameKey: "asc" } }),
    db.file.findMany({ where: { folderId, deletedAt: null, archivedAt: null, status: "available" }, orderBy: { nameKey: "asc" }, take: 1000 }),
    db.folder.findUnique({ where: { id: rootId }, select: { owner: { select: { displayName: true } } } }),
  ]);
  return { rootId, ownerName: owner?.owner.displayName ?? "", breadcrumbs: path, folders, files: files.map(toFileDto) };
}

/** A file the caller may read because it sits in a folder shared with them. */
export async function getSharedFileRow(actor: Actor, fileId: string): Promise<FileRow> {
  const file = await db.file.findFirst({ where: { id: fileId, deletedAt: null, archivedAt: null, folderId: { not: null } } });
  if (!file || !file.folderId) throw Errors.notFound();
  await resolveAccess(actor, file.folderId);
  return file;
}
