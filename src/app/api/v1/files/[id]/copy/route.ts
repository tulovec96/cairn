import { z } from "zod";
import { caller, nullableId } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { copyFile } from "@/server/services/files";

export const dynamic = "force-dynamic";

const schema = z.object({ folderId: nullableId.optional(), name: z.string().min(1).max(1024).optional() });

/** Copies the file (data included) into a folder; counts against storage like any upload. */
export const POST = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  const input = await parseJson(ctx.req, schema);
  return { file: await copyFile(actor, idParam.parse(ctx.params.id), input) };
}, { status: 201 });