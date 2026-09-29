import { z } from "zod";
import { caller } from "@/server/api";
import { idParam, route, type Ctx } from "@/server/http";
import { serveThumbnail } from "@/server/services/download";
import { fileCanBeServed, getFileRow } from "@/server/services/files";

export const dynamic = "force-dynamic";

const sizeSchema = z.enum(["s", "m", "l"]).default("m");

async function handle(ctx: Ctx<{ id: string }>) {
  const actor = await caller(ctx, "files:read");
  const file = await getFileRow(actor, idParam.parse(ctx.params.id));
  fileCanBeServed(file);
  const size = sizeSchema.safeParse(new URL(ctx.req.url).searchParams.get("size") ?? undefined);
  return serveThumbnail(ctx.req, file, size.success ? size.data : "m");
}

export const GET = route<{ id: string }>(handle);
export const HEAD = route<{ id: string }>(handle);
