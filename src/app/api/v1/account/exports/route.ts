import { sessionCaller } from "@/server/api";
import { route } from "@/server/http";
import { listExports, requestExport } from "@/server/services/transfer";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { items: await listExports(actor) };
});

/** Starts building a ZIP with your profile, settings, file metadata, shares and personal files. */
export const POST = route(async (ctx) => {
  const actor = await sessionCaller(ctx);
  return { export: await requestExport(actor) };
}, { status: 202 });