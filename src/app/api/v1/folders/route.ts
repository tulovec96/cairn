import { z } from "zod";
import { caller, nullableId } from "@/server/api";
import { parseJson, route } from "@/server/http";
import { actorLabel, scopeOf } from "@/server/services/actor";
import { audit } from "@/server/services/audit";
import { createFolder, listAllFolders } from "@/server/services/folders";
import { assertCan } from "@/server/services/permissions";
import { emit } from "@/server/events";
import { serializeFolder } from "@/server/services/serializers";

export const dynamic = "force-dynamic";

/** Flat list of every folder (id, name, parentId, color) — enough to build a tree client-side. */
export const GET = route(async (ctx) => {
  const actor = await caller(ctx, "files:read");
  return { folders: await listAllFolders(scopeOf(actor)) };
});

const schema = z.object({
  name: z.string().min(1).max(255),
  parentId: nullableId.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  description: z.string().max(2000).optional(),
});

export const POST = route(async (ctx) => {
  const actor = await caller(ctx, "folders:write");
  assertCan(actor, "write");
  const input = await parseJson(ctx.req, schema);
  const scope = scopeOf(actor);
  const folder = await createFolder(scope, { name: input.name, parentId: input.parentId ?? null, color: input.color, description: input.description });
  await audit({ ...actorLabel(actor), action: "folder.created", targetType: "folder", targetId: folder.id, ip: ctx.ip, metadata: { name: folder.name } });
  await emit({ type: "folder.created", workspaceId: scope.orgId ?? scope.userId, ownerId: actor.user.id, orgId: scope.orgId, actorId: actor.user.id, actorLabel: actor.user.displayName, folderId: folder.id, targetName: folder.name });
  return { folder: serializeFolder(folder) };
}, { status: 201 });
