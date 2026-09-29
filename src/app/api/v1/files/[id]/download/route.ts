import { caller } from "@/server/api";
import { db } from "@/server/db";
import { idParam, route, type Ctx } from "@/server/http";
import * as rate from "@/server/ratelimit";
import { getSettings } from "@/server/settings";
import { fileCanBeServed, getFileRow } from "@/server/services/files";
import { recordDownload, serveFile } from "@/server/services/download";

export const dynamic = "force-dynamic";

async function handle(ctx: Ctx<{ id: string }>) {
  const actor = await caller(ctx, "files:read");
  const settings = await getSettings();
  rate.enforce(`download:${actor.user.id}`, settings.rateLimits.download);
  const file = await getFileRow(actor, idParam.parse(ctx.params.id));
  fileCanBeServed(file);
  const res = await serveFile(ctx.req, file, { mode: "download", onStart: () => recordDownload(file.id) });
  if (ctx.req.method !== "HEAD") void db.file.update({ where: { id: file.id }, data: { lastAccessedAt: new Date() } }).catch(() => undefined);
  return res;
}

/** Streams the file with HTTP Range support (resumable downloads). */
export const GET = route<{ id: string }>(handle);
export const HEAD = route<{ id: string }>(handle);
