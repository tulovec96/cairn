import { adminCaller } from "@/server/api";
import { db } from "@/server/db";
import { ApiError } from "@/server/errors";
import { parseJson, route, zodDetails } from "@/server/http";
import { audit } from "@/server/services/audit";
import { getSettings, updateSettings } from "@/server/settings";
import { z } from "zod";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => {
  await adminCaller(ctx);
  const [settings, row] = await Promise.all([getSettings(), db.systemSetting.findUnique({ where: { key: "config" } })]);
  return { settings, updatedAt: row?.updatedAt.toISOString() ?? null };
});

/** Partial update: send only the sections/fields you want to change. Values are validated against the full schema. */
export const PUT = route(async (ctx) => {
  const admin = await adminCaller(ctx);
  const patch = await parseJson(ctx.req, z.record(z.string(), z.unknown()));
  try {
    const settings = await updateSettings(patch, admin.user.id);
    await audit({ actorType: "admin", actorId: admin.user.id, action: "admin.settings_updated", ip: ctx.ip, metadata: { sections: Object.keys(patch).join(",") } });
    return { settings };
  } catch (err) {
    if (err instanceof z.ZodError) throw new ApiError(422, "validation_error", "Some settings are invalid.", { details: zodDetails(err) });
    throw err;
  }
});
