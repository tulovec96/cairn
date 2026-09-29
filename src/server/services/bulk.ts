import { z } from "zod";
import { idParam } from "../http";
import { actorLabel, scopeOf, type Actor } from "./actor";
import { audit } from "./audit";
import { copyFile, setFavorites, updateFile } from "./files";
import { moveFolder } from "./folders";
import { assertCan } from "./permissions";
import { createShare } from "./shares";
import { applyTags } from "./tags";
import { deleteItems, purgeTrashItem, restoreTrashItem } from "./trash";
import type { ShareDto } from "@/lib/types";

const ids = z.array(idParam).max(500).default([]);
const isoDate = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const tagName = z.string().trim().min(1).max(40);

export const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), fileIds: ids, folderIds: ids }),
  z.object({ action: z.literal("move"), fileIds: ids, folderIds: ids, targetFolderId: idParam.nullable() }),
  z.object({ action: z.literal("copy"), fileIds: ids, targetFolderId: idParam.nullable() }),
  z.object({ action: z.literal("favorite"), fileIds: ids, folderIds: ids }),
  z.object({ action: z.literal("unfavorite"), fileIds: ids, folderIds: ids }),
  z.object({ action: z.literal("archive"), fileIds: ids }),
  z.object({ action: z.literal("unarchive"), fileIds: ids }),
  z.object({ action: z.literal("tag"), fileIds: ids, add: z.array(tagName).max(20).default([]), removeIds: z.array(idParam).max(20).default([]) }),
  z.object({ action: z.literal("expiry"), fileIds: ids, expiresAt: isoDate.nullable() }),
  z.object({ action: z.literal("color"), fileIds: ids, colorLabel: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable() }),
  z.object({
    action: z.literal("share"),
    fileIds: ids,
    folderIds: ids,
    password: z.string().min(4).max(128).nullable().optional(),
    expiresAt: isoDate.nullable().optional(),
    maxDownloads: z.number().int().min(1).max(1_000_000).nullable().optional(),
  }),
  z.object({ action: z.literal("restore"), trashIds: ids }),
  z.object({ action: z.literal("purge"), trashIds: ids }),
]);

export type BulkInput = z.infer<typeof bulkSchema>;

export interface BulkResult {
  done: number;
  failed: Array<{ id: string; message: string }>;
  shares?: ShareDto[];
  /** For deletes: trash entry ids, so the caller can offer undo. */
  trashIds?: string[];
}

export async function runBulk(actor: Actor, input: BulkInput, ip?: string): Promise<BulkResult> {
  const result: BulkResult = { done: 0, failed: [] };
  const scope = scopeOf(actor);
  const attempt = async (id: string, fn: () => Promise<void>) => {
    try {
      await fn();
      result.done++;
    } catch (err) {
      result.failed.push({ id, message: (err as Error).message || "Failed" });
    }
  };

  switch (input.action) {
    case "delete": {
      const r = await deleteItems(actor, { fileIds: input.fileIds, folderIds: input.folderIds }, ip);
      result.done = r.trashed;
      result.trashIds = r.batches;
      break;
    }
    case "move": {
      for (const id of input.folderIds) await attempt(id, async () => void (await moveFolder(scope, id, input.targetFolderId)));
      for (const id of input.fileIds) await attempt(id, async () => void (await updateFile(actor, id, { folderId: input.targetFolderId })));
      if (result.done) await audit({ ...actorLabel(actor), action: "file.moved", ip, metadata: { count: result.done, target: input.targetFolderId } });
      break;
    }
    case "copy": {
      for (const id of input.fileIds) await attempt(id, async () => void (await copyFile(actor, id, { folderId: input.targetFolderId })));
      break;
    }
    case "favorite":
    case "unfavorite": {
      result.done = await setFavorites(actor, { fileIds: input.fileIds, folderIds: input.folderIds }, input.action === "favorite");
      break;
    }
    case "archive":
    case "unarchive": {
      for (const id of input.fileIds) await attempt(id, async () => void (await updateFile(actor, id, { archived: input.action === "archive" })));
      break;
    }
    case "tag": {
      const r = await applyTags(actor, { fileIds: input.fileIds, add: input.add, removeIds: input.removeIds });
      result.done = r.files;
      break;
    }
    case "expiry": {
      for (const id of input.fileIds) await attempt(id, async () => void (await updateFile(actor, id, { expiresAt: input.expiresAt })));
      break;
    }
    case "color": {
      for (const id of input.fileIds) await attempt(id, async () => void (await updateFile(actor, id, { colorLabel: input.colorLabel })));
      break;
    }
    case "share": {
      assertCan(actor, "share");
      result.shares = [];
      const base = { password: input.password ?? null, expiresAt: input.expiresAt ?? null, maxDownloads: input.maxDownloads ?? null };
      for (const id of input.fileIds) {
        await attempt(id, async () => void result.shares!.push(await createShare(actor, { fileId: id, ...base }, ip)));
      }
      for (const id of input.folderIds) {
        await attempt(id, async () => void result.shares!.push(await createShare(actor, { folderId: id, ...base }, ip)));
      }
      break;
    }
    case "restore": {
      for (const id of input.trashIds) await attempt(id, () => restoreTrashItem(actor, id, ip));
      break;
    }
    case "purge": {
      assertCan(actor, "delete");
      for (const id of input.trashIds) await attempt(id, async () => void (await purgeTrashItem(scope, id)));
      break;
    }
  }
  return result;
}
