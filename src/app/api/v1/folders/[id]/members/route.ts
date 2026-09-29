import { caller } from "@/server/api";
import { idParam, parseJson, route } from "@/server/http";
import { addFolderMember, listFolderMembers, memberSchema } from "@/server/services/sharedFolders";

export const dynamic = "force-dynamic";

/** People this folder is shared with (view-only). Only the folder's owner can see the list. */
export const GET = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "shares:write");
  return { items: await listFolderMembers(actor, idParam.parse(ctx.params.id)) };
});

/** Share the folder with someone by email. The response is the same whether or not that address has an account. */
export const POST = route<{ id: string }>(async (ctx) => {
  const actor = await caller(ctx, "shares:write");
  const { email } = await parseJson(ctx.req, memberSchema);
  const res = await addFolderMember(actor, idParam.parse(ctx.params.id), email, ctx.ip);
  return { items: res.members, note: res.note };
}, { status: 201 });
