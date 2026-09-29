import { z } from "zod";
import { Errors } from "@/server/errors";
import { assertSameOrigin, parseJson, route } from "@/server/http";
import { isRequestUnlocked, loadPublicRequest } from "@/server/services/fileRequests";
import { initRequestUpload } from "@/server/services/uploads";

export const dynamic = "force-dynamic";

const schema = z.object({
  fileName: z.string().min(1).max(1024),
  size: z.number().int().positive(),
  uploaderLabel: z.string().trim().max(80).nullable().optional(),
});

/**
 * Starts a resumable upload for someone without an account. The response carries an `uploadKey`: send it as
 * the `X-Upload-Key` header on the chunk, status and complete calls. The key only works for this one upload.
 */
export const POST = route<{ token: string }>(async (ctx) => {
  assertSameOrigin(ctx.req);
  const r = await loadPublicRequest(ctx.params.token);
  if (!isRequestUnlocked(ctx.req, r)) throw Errors.passwordRequired();
  const input = await parseJson(ctx.req, schema);
  return { upload: await initRequestUpload(r.id, input, ctx.ip) };
}, { status: 201 });