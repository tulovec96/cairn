import { caller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { getArchive, toArchiveDto } from "@/server/services/archives";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return { archive: toArchiveDto(await getArchive(actor, idParam.parse(ctx.params.id))) };
});
