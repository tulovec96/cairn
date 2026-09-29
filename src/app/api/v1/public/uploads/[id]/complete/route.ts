import { z } from "zod";
import { hex64 } from "@/server/api";
import { Errors } from "@/server/errors";
import { idParam, parseJson, parseQuery, route } from "@/server/http";
import { completeUpload } from "@/server/services/uploads";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (ctx) => {
  const uploadKey = ctx.req.headers.get("x-upload-key");
  if (!uploadKey) throw Errors.unauthorized("Missing X-Upload-Key header.");
  const body = await parseJson(ctx.req, z.object({ sha256: hex64.nullable().optional() }));
  const { wait } = parseQuery(ctx.req, z.object({ wait: z.coerce.number().int().min(0).max(120).optional() }));
  return { upload: await completeUpload({ uploadKey }, idParam.parse(ctx.params.id), { sha256: body.sha256, waitMs: (wait ?? 0) * 1000 }) };
}, { status: 202 });