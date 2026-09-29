import { adminCaller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { deleteUserAccount, getUserDetail, updateUser, updateUserSchema } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (ctx) => {
  await adminCaller(ctx);
  return getUserDetail(idParam.parse(ctx.params.id));
});

/** Suspend/restore, change role, or override the user's quota and max file size. */
export const PATCH = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  const patch = await parseJson(ctx.req, updateUserSchema);
  return { user: await updateUser(admin, idParam.parse(ctx.params.id), patch, ctx.ip) };
});

/** Permanently deletes the account, its files and all metadata. */
export const DELETE = route<{ id: string }>(async (ctx) => {
  const admin = await adminCaller(ctx);
  await deleteUserAccount(admin, idParam.parse(ctx.params.id), ctx.ip);
  return { ok: true };
});
