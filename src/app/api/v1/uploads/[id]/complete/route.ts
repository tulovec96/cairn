import { z } from "zod";
import { caller, hex64 } from "@/server/api";
import { idParam, parseJson, parseQuery, route } from "@/server/http";
import { completeUpload } from "@/server/services/uploads";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ sha256: hex64.nullable().optional() });
const querySchema = z.object({ wait: z.coerce.number().int().min(0).max(120).optional() });

/**
 * Finalizes an upload once every chunk is present. Verification, hashing and storage happen in the
 * background; poll GET /uploads/{id} (or pass ?wait=<seconds>) until status is "complete".
 */
export const POST = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:upload");
  const body = await parseJson(ctx.req, bodySchema);
  const { wait } = parseQuery(ctx.req, querySchema);
  const upload = await completeUpload({ actor }, idParam.parse(ctx.params.id), { sha256: body.sha256, waitMs: (wait ?? 0) * 1000 });
  return { upload };
}, { status: 202 });
