import { z } from "zod";
import { caller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { applyBatchRename, batchRenameSchema, previewBatchRename } from "@/server/services/library";

export const dynamic = "force-dynamic";

const schema = batchRenameSchema.extend({ apply: z.boolean().default(false) });

/** With `apply: false` returns what each name would become (and any conflicts). With `apply: true` renames, all or nothing. */
export const POST = route(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  const { apply, ...input } = await parseJson(ctx.req, schema);
  return apply ? applyBatchRename(actor, input) : { rows: await previewBatchRename(actor, input) };
});