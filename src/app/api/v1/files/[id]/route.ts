import { z } from "zod";
import { caller, isoDateTime, nullableId } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { getFileDetails, getFileDto, setFavorites, touchAccessed, updateFile } from "@/server/services/files";
import { deleteItems } from "@/server/services/trash";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  const id = idParam.parse(ctx.params.id);
  const details = await getFileDetails(actor, id);
  await touchAccessed(id);
  return details;
});

const patchSchema = z.object({
  name: z.string().min(1).max(1024).optional(),
  folderId: nullableId.optional(),
  expiresAt: isoDateTime.nullable().optional(),
  favorite: z.boolean().optional(),
  description: z.string().max(2000).optional(),
  notes: z.string().max(10_000).optional(),
  colorLabel: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colors must look like #2557e8.").nullable().optional(),
  metadata: z.record(z.string().max(60), z.string().max(500)).optional(),
  archived: z.boolean().optional(),
});

export const PATCH = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  const id = idParam.parse(ctx.params.id);
  const { favorite, ...patch } = await parseJson(ctx.req, patchSchema);
  if (favorite !== undefined) await setFavorites(actor, { fileIds: [id] }, favorite);
  if (Object.keys(patch).length) return { file: await updateFile(actor, id, patch) };
  return { file: await getFileDto(actor, id) };
});

/** Moves the file to the trash; it can be restored until the plan's trash retention period ends. */
export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:delete");
  const id = idParam.parse(ctx.params.id);
  await getFileDto(actor, id);
  const result = await deleteItems(actor, { fileIds: [id] }, ctx.ip);
  return { trashed: result.trashed, trashIds: result.batches };
});
