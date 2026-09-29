import { caller } from "@/server/api";
import { idParam, route, type Ctx } from "@/server/http";
import * as rate from "@/server/ratelimit";
import { getSettings } from "@/server/settings";
import { recordDownload, serveFile } from "@/server/services/download";
import { fileCanBeServed } from "@/server/services/files";
import { getSharedFileRow } from "@/server/services/sharedFolders";
import { assertTransferAvailable } from "@/server/services/usage";

export const dynamic = "force-dynamic";

async function handle(ctx: Ctx<{ id: string }>) {
  const actor = await caller(ctx, "files:read");
  const settings = await getSettings();
  rate.enforce(`download:${actor.user.id}`, settings.rateLimits.download);
  const file = await getSharedFileRow(actor, idParam.parse(ctx.params.id));
  fileCanBeServed(file);
  // The owner's plan pays for the transfer, exactly as with a share link.
  await assertTransferAvailable({ userId: file.ownerId, orgId: file.orgId }, Number(file.size));
  return serveFile(ctx.req, file, { mode: "download", onStart: () => recordDownload(file.id, null, undefined, actor.user.displayName) });
}

export const GET = route<{ id: string }>(handle);
export const HEAD = route<{ id: string }>(handle);
