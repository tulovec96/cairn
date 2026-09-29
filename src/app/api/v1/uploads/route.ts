import { z } from "zod";
import { caller, hex64, isoDateTime, nullableId } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { enforceUploadInitLimits, initUpload } from "@/server/services/uploads";

export const dynamic = "force-dynamic";

const schema = z.object({
  fileName: z.string().min(1).max(1024),
  size: z.number().int().positive(),
  mime: z.string().max(200).optional(),
  folderId: nullableId.optional(),
  share: z.boolean().optional(),
  /** Omit for the plan default, null for "never", or an ISO date-time. */
  expiresAt: isoDateTime.nullable().optional(),
  password: z.string().min(4).max(128).nullable().optional(),
  maxDownloads: z.number().int().min(1).max(1_000_000).nullable().optional(),
  sha256: hex64.nullable().optional(),
  /** Upload the content as a new version of this file. */
  replaceFileId: idParam.nullable().optional(),
});

/** Starts a resumable upload session. Uploading always needs an account or an API key. */
export const POST = route(async (ctx) => {
  const input = await parseJson(ctx.req, schema);
  const actor = await caller(ctx, "files:upload");
  await enforceUploadInitLimits(actor);
  return { upload: await initUpload(actor, input) };
}, { status: 201 });
