import { z } from "zod";
import { caller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { createArchive } from "@/server/services/archives";

export const dynamic = "force-dynamic";

const schema = z
  .object({ fileIds: z.array(idParam).max(1000).default([]), folderIds: z.array(idParam).max(200).default([]) })
  .refine((v) => v.fileIds.length + v.folderIds.length > 0, { message: "Select at least one file or folder." });

/**
 * Starts building a ZIP of the selection in the background. Poll GET /archives/{id} for progress,
 * then download from /archives/{id}/download when status is "ready".
 */
export const POST = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  const input = await parseJson(ctx.req, schema);
  return { archive: await createArchive(actor, input) };
}, { status: 202 });
