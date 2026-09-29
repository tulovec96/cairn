import { adminCaller } from "@/server/api";
import { route } from "@/server/http";
import { adminFlags } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return { items: await adminFlags() };
});