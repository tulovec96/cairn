import type { Tag } from "@prisma/client";
import { db } from "../db";
import { Errors } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { TAG_COLORS, type TagDto } from "@/lib/types";
import { ownerWhere, scopeOf, workspaceIdOf, type Actor } from "./actor";
import { assertCan } from "./permissions";
import { serializeTag } from "./serializers";

const NAME_RE = /^[^\u0000-\u001f]{1,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!NAME_RE.test(name)) throw Errors.validation("Tag names can be up to 40 characters.");
  return name;
}

export async function listTags(actor: Actor): Promise<Array<TagDto & { fileCount: number }>> {
  const ws = workspaceIdOf(scopeOf(actor));
  const tags = await db.tag.findMany({ where: { workspaceId: ws }, orderBy: { nameKey: "asc" }, include: { _count: { select: { files: { where: { file: { deletedAt: null } } } } } } });
  return tags.map((t) => ({ ...serializeTag(t), fileCount: t._count.files }));
}

export async function createTag(actor: Actor, input: { name: string; color?: string }): Promise<TagDto> {
  assertCan(actor, "write");
  const name = cleanName(input.name);
  const scope = scopeOf(actor);
  const nameKey = name.toLowerCase();
  const existing = await db.tag.findUnique({ where: { workspaceId_nameKey: { workspaceId: workspaceIdOf(scope), nameKey } } });
  if (existing) throw Errors.conflict("A tag with that name already exists.");
  if (input.color && !COLOR_RE.test(input.color)) throw Errors.validation("Colors must look like #2557e8.");
  const count = await db.tag.count({ where: { workspaceId: workspaceIdOf(scope) } });
  if (count >= 500) throw Errors.conflict("You've reached the limit of 500 tags.");
  const tag = await db.tag.create({
    data: { id: newId("tag"), workspaceId: workspaceIdOf(scope), orgId: scope.orgId, name, nameKey, color: input.color ?? TAG_COLORS[count % TAG_COLORS.length] },
  });
  return serializeTag(tag);
}

async function ownedTag(actor: Actor, id: string) {
  const tag = await db.tag.findFirst({ where: { id, workspaceId: workspaceIdOf(scopeOf(actor)) } });
  if (!tag) throw Errors.notFound("That tag doesn't exist.");
  return tag;
}

export async function updateTag(actor: Actor, id: string, patch: { name?: string; color?: string }): Promise<TagDto> {
  assertCan(actor, "write");
  const tag = await ownedTag(actor, id);
  const data: { name?: string; nameKey?: string; color?: string } = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    const clash = await db.tag.findFirst({ where: { workspaceId: tag.workspaceId, nameKey: name.toLowerCase(), id: { not: id } } });
    if (clash) throw Errors.conflict("A tag with that name already exists.");
    data.name = name;
    data.nameKey = name.toLowerCase();
  }
  if (patch.color !== undefined) {
    if (!COLOR_RE.test(patch.color)) throw Errors.validation("Colors must look like #2557e8.");
    data.color = patch.color;
  }
  return serializeTag(await db.tag.update({ where: { id }, data }));
}

export async function deleteTag(actor: Actor, id: string): Promise<void> {
  assertCan(actor, "write");
  await ownedTag(actor, id);
  await db.tag.delete({ where: { id } });
}

/** Adds tags (by name, created on demand) to and removes tags (by id) from many files in one go. */
export async function applyTags(actor: Actor, input: { fileIds: string[]; add?: string[]; removeIds?: string[] }): Promise<{ files: number }> {
  assertCan(actor, "write");
  const scope = scopeOf(actor);
  const ws = workspaceIdOf(scope);
  const files = await db.file.findMany({ where: { id: { in: input.fileIds }, ...ownerWhere(actor), deletedAt: null }, select: { id: true, originalName: true, ownerId: true, orgId: true } });
  if (!files.length) return { files: 0 };

  const addTags: Tag[] = [];
  for (const raw of input.add ?? []) {
    const name = cleanName(raw);
    let tag = await db.tag.findUnique({ where: { workspaceId_nameKey: { workspaceId: ws, nameKey: name.toLowerCase() } } });
    if (!tag) tag = await db.tag.create({ data: { id: newId("tag"), workspaceId: ws, orgId: scope.orgId, name, nameKey: name.toLowerCase(), color: TAG_COLORS[(await db.tag.count({ where: { workspaceId: ws } })) % TAG_COLORS.length] } });
    addTags.push(tag);
  }
  if (addTags.length) {
    await db.fileTag.createMany({ data: files.flatMap((f) => addTags.map((t) => ({ fileId: f.id, tagId: t.id }))) }).catch(async () => {
      // SQLite has no skipDuplicates: fall back to inserting one by one and ignoring existing pairs.
      for (const f of files) for (const t of addTags) await db.fileTag.upsert({ where: { fileId_tagId: { fileId: f.id, tagId: t.id } }, create: { fileId: f.id, tagId: t.id }, update: {} });
    });
  }
  if (input.removeIds?.length) {
    const valid = await db.tag.findMany({ where: { id: { in: input.removeIds }, workspaceId: ws }, select: { id: true } });
    await db.fileTag.deleteMany({ where: { fileId: { in: files.map((f) => f.id) }, tagId: { in: valid.map((t) => t.id) } } });
  }
  for (const f of files) {
    await emit({ type: "file.tagged", workspaceId: ws, ownerId: f.ownerId, orgId: f.orgId, actorId: actor.user.id, actorLabel: actor.user.displayName, fileId: f.id, targetName: f.originalName, data: { added: addTags.map((t) => t.name), removed: input.removeIds?.length ?? 0 } });
  }
  return { files: files.length };
}
