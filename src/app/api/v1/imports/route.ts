import { caller } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { createImport, importSchema, listImports } from "@/server/services/transfer";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return { items: await listImports(actor) };
});

/** Fetches a file from a public web address into your storage. Private and internal addresses are refused. */
export const POST = route(async (ctx) => {
  const actor = await caller(ctx, "files:upload");
  return { import: await createImport(actor, await parseJson(ctx.req, importSchema)) };
}, { status: 202 });