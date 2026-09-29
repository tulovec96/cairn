import { Errors } from "../errors";
import type { Actor, OrgRole } from "./actor";

export type Action = "read" | "comment" | "write" | "delete" | "share" | "manage";

/**
 * What each organization role may do with the organization's content. Personal workspaces always allow
 * everything to their owner. "manage" covers members, billing and organization settings.
 */
export const ROLE_ACTIONS: Record<OrgRole, readonly Action[]> = {
  owner: ["read", "comment", "write", "delete", "share", "manage"],
  admin: ["read", "comment", "write", "delete", "share", "manage"],
  member: ["read", "comment", "write", "delete", "share"],
  viewer: ["read", "comment"],
};

export function can(actor: Actor, action: Action): boolean {
  const role = actor.workspace.role;
  if (!actor.workspace.orgId || !role) return true;
  return ROLE_ACTIONS[role].includes(action);
}

export function assertCan(actor: Actor, action: Action): void {
  if (!can(actor, action)) throw Errors.forbidden(`Your role in ${actor.workspace.orgName ?? "this organization"} (${actor.workspace.role}) doesn't allow that.`);
}
