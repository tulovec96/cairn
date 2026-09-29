import { adminCaller } from "@/server/api";
import { route } from "@/server/http";
import { retryFailedJobs } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const POST = route(async (ctx) => {
  const admin = await adminCaller(ctx);
  return { requeued: await retryFailedJobs(admin.user.id) };
});
