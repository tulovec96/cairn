import { adminCaller } from "@/server/api";
import { route } from "@/server/http";
import { adminHealth } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

/** Runs every health check now and reports configuration that affects operations. */
export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return adminHealth();
});