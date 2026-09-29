import { adminCaller } from "@/server/api";
import { route } from "@/server/http";
import { emailStatus } from "@/server/services/email";
import { adminEmailOutbox } from "@/server/services/adminExtra";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  return { status: emailStatus(), items: await adminEmailOutbox() };
});