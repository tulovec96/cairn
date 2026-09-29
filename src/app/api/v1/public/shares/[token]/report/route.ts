import { assertSameOrigin, parseJson, route } from "@/server/http";
import { createReport, reportSchema } from "@/server/services/reports";

export const dynamic = "force-dynamic";

/** Report a shared file for abuse. Rate limited per network address. */
export const POST = route<{ token: string }>(async (ctx) => {
  assertSameOrigin(ctx.req);
  const input = await parseJson(ctx.req, reportSchema);
  return { report: await createReport(ctx.params.token, input, ctx.ip) };
}, { status: 201 });
