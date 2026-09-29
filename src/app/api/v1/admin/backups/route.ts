import { adminCaller } from "@/server/api";
import { route } from "@/server/http";
import { adminCreateBackup, adminListBackups } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return { items: await adminListBackups() };
});

/** Creates a database backup now. File blobs are not included: back up the storage provider separately. */
export const POST = route(async (ctx) => {
  const admin = await adminCaller(ctx);
  await adminCreateBackup(admin.user.id);
  return { items: await adminListBackups() };
}, { status: 201 });