import { z } from "zod";
import { caller } from "@/server/api";
import { idParam, noContent, route } from "@/server/http";
import { deleteVersion, restoreVersion } from "@/server/services/versions";

export const dynamic = "force-dynamic";

const versionParam = z.coerce.number().int().min(1);

/** Makes this version the current one (the version it replaces is kept). */
export const POST = route<{ id: string; version: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:write");
  return restoreVersion(actor, idParam.parse(ctx.params.id), versionParam.parse(ctx.params.version));
});

export const DELETE = route<{ id: string; version: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:delete");
  await deleteVersion(actor, idParam.parse(ctx.params.id), versionParam.parse(ctx.params.version));
  return noContent();
});