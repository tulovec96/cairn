import { z } from "zod";
import { caller } from "@/server/api";
import { idParam, route } from "@/server/http";
import { receiveChunk } from "@/server/services/uploads";

export const dynamic = "force-dynamic";

/**
 * Receives one chunk as a raw request body. Chunks may arrive in any order and can be re-sent safely.
 * Optional header `X-Chunk-Sha256` is verified against the bytes the server actually received.
 */
export const PUT = route<{ id: string; index: string }>(async (ctx) => {
  const actor = await caller(ctx, "files:upload");
  const index = z.coerce.number().int().min(0).parse(ctx.params.index);
  const result = await receiveChunk({ actor }, idParam.parse(ctx.params.id), index, ctx.req);
  return { chunk: result };
});
