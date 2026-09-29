import { adminCaller } from "@/server/api";
import { route } from "@/server/http";
import { adminOverview } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return adminOverview();
});
