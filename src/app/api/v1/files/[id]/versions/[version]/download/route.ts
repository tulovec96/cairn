import { z } from "zod";
import { caller } from "@/server/api";
import { idParam, route, type Ctx } from "@/server/http";
import { serveFile } from "@/server/services/download";
import { fileCanBeServed } from "@/server/services/files";
import { getVersionForDownload } from "@/server/services/versions";

export const dynamic = "force-dynamic";

async function handle(ctx: Ctx<{ id: string; version: string }>) {
  const actor = await caller(ctx, "files:read");
  const v = await getVersionForDownload(actor, idParam.parse(ctx.params.id), z.coerce.number().int().min(1).parse(ctx.params.version));
  fileCanBeServed(v.file);
  return serveFile(ctx.req, { ...v.file, storageKey: v.storageKey, sha256: v.sha256, mime: v.mime, size: BigInt(v.size) }, { mode: "download" });
}

export const GET = route<{ id: string; version: string }>(handle);
export const HEAD = route<{ id: string; version: string }>(handle);