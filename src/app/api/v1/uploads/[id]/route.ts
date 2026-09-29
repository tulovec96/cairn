import { caller } from "@/server/api";
import { idParam, noContent, route } from "@/server/http";
import { abortUpload, getUploadSession } from "@/server/services/uploads";

export const dynamic = "force-dynamic";

/** Upload status, including which chunk indexes the server has received (used to resume). */
export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:upload");
  return { upload: await getUploadSession({ actor }, idParam.parse(ctx.params.id)) };
});

/** Cancels an in-progress upload and discards its data. */
export const DELETE = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:upload");
  await abortUpload({ actor }, idParam.parse(ctx.params.id));
  return noContent();
});
