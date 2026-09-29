import { Errors } from "@/server/errors";
import { idParam, noContent, route } from "@/server/http";
import { abortUpload, getUploadSession } from "@/server/services/uploads";

export const dynamic = "force-dynamic";

function key(req: Request): string {
  const k = req.headers.get("x-upload-key");
  if (!k) throw Errors.unauthorized("Missing X-Upload-Key header.");
  return k;
}

export const GET = route<{ id: string }>(async (ctx) => ({ upload: await getUploadSession({ uploadKey: key(ctx.req) }, idParam.parse(ctx.params.id)) }));

export const DELETE = route<{ id: string }>(async (ctx) => {
  await abortUpload({ uploadKey: key(ctx.req) }, idParam.parse(ctx.params.id));
  return noContent();
});