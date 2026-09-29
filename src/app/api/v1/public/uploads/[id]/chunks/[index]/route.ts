import { z } from "zod";
import { Errors } from "@/server/errors";
import { idParam, route } from "@/server/http";
import { receiveChunk } from "@/server/services/uploads";

export const dynamic = "force-dynamic";

export const PUT = route<{ id: string; index: string }>(async (ctx) => {
  const uploadKey = ctx.req.headers.get("x-upload-key");
  if (!uploadKey) throw Errors.unauthorized("Missing X-Upload-Key header.");
  const index = z.coerce.number().int().min(0).parse(ctx.params.index);
  return { chunk: await receiveChunk({ uploadKey }, idParam.parse(ctx.params.id), index, ctx.req) };
});