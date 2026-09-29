import { z } from "zod";
import type { Organization, OrganizationMember } from "@prisma/client";
import { db } from "../db";
import { hashToken } from "../crypto";
import { env } from "../env";
import { Errors } from "../errors";
import { newId, newSecretToken } from "../ids";
import * as rate from "../ratelimit";
import { audit } from "./audit";
import { assertFeature, assertLimit, entitlementsForOrg, entitlementsForUser, getPlan } from "./entitlements";
import { queueEmail } from "./email";
import { destroyFiles } from "./files";
import { notify } from "./notifications";
import { storage } from "../storage";
import type { Actor, OrgRole } from "./actor";
import { assertCan } from "./permissions";
import { emailSchema } from "./auth";

/**
 * Organizations are shared workspaces: files, folders, tags, requests, webhooks and automations belong to the
 * organization, storage and limits come from the organization's plan, and members act with a role
 * (owner, admin, member, viewer — see services/permissions.ts for exactly what each may do).
 */

const RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
const ROLES = ["admin", "member", "viewer"] as const;

export interface OrgDto {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
  planKey: string;
  planName: string;
  memberCount: number;
  createdAt: string;
}

export interface MemberDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  avatarUrl: string | null;
  joinedAt: string;
  you: boolean;
}

export interface InviteDto {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  createdAt: string;
}

export const orgNameSchema = z.object({ name: z.string().trim().min(2, "Give the organization a name.").max(60) });
export const inviteSchema = z.object({ email: emailSchema, role: z.enum(ROLES) });

function slugify(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "team";
  return base;
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await db.organization.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${base}-${newSecretToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

async function toOrgDto(org: Organization, role: OrgRole): Promise<OrgDto> {
  const [plan, memberCount] = await Promise.all([getPlan(org.planKey), db.organizationMember.count({ where: { orgId: org.id } })]);
  return { id: org.id, name: org.name, slug: org.slug, role, planKey: plan.key, planName: plan.name, memberCount, createdAt: org.createdAt.toISOString() };
}

export async function listMyOrgs(actor: Actor): Promise<OrgDto[]> {
  const rows = await db.organizationMember.findMany({ where: { userId: actor.user.id }, include: { org: true }, orderBy: { createdAt: "asc" } });
  return Promise.all(rows.map((m) => toOrgDto(m.org, m.role as OrgRole)));
}

export async function createOrg(actor: Actor, input: z.infer<typeof orgNameSchema>, ip?: string): Promise<OrgDto> {
  if (actor.workspace.orgId) throw Errors.conflict("Switch to your personal workspace to create an organization.");
  const ent = await entitlementsForUser(actor.user);
  await assertFeature(ent, "teams");
  assertLimit(ent, "organizations", await db.organization.count({ where: { ownerId: actor.user.id } }));
  const org = await db.organization.create({
    data: {
      id: newId("org"),
      name: input.name,
      slug: await uniqueSlug(input.name),
      ownerId: actor.user.id,
      planKey: actor.user.planKey,
      timezone: actor.user.timezone,
      members: { create: { id: newId("mem"), userId: actor.user.id, role: "owner" } },
    },
  });
  await audit({ actorType: "user", actorId: actor.user.id, action: "org.created", targetType: "org", targetId: org.id, ip, metadata: { name: org.name } });
  return toOrgDto(org, "owner");
}

async function loadOrg(actor: Actor, orgId: string): Promise<{ org: Organization; me: OrganizationMember }> {
  const me = await db.organizationMember.findUnique({ where: { orgId_userId: { orgId, userId: actor.user.id } }, include: { org: true } });
  if (!me) throw Errors.notFound("That organization doesn't exist or you aren't a member.");
  return { org: me.org, me };
}

function assertManage(me: OrganizationMember) {
  if (me.role !== "owner" && me.role !== "admin") throw Errors.forbidden("Only owners and admins can do that.");
}

export async function getOrg(actor: Actor, orgId: string) {
  const { org, me } = await loadOrg(actor, orgId);
  const canManage = me.role === "owner" || me.role === "admin";
  const [members, invites, ent] = await Promise.all([
    db.organizationMember.findMany({ where: { orgId }, include: { user: { select: { id: true, displayName: true, email: true, avatarKey: true, updatedAt: true } } }, orderBy: { createdAt: "asc" } }),
    canManage ? db.organizationInvite.findMany({ where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    entitlementsForOrg(org),
  ]);
  return {
    org: await toOrgDto(org, me.role as OrgRole),
    members: members.map<MemberDto>((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.displayName,
      email: canManage || m.userId === actor.user.id ? m.user.email : "",
      role: m.role as OrgRole,
      avatarUrl: m.user.avatarKey ? `/api/v1/users/${m.user.id}/avatar?v=${m.user.updatedAt.getTime()}` : null,
      joinedAt: m.createdAt.toISOString(),
      you: m.userId === actor.user.id,
    })),
    invites: invites.map<InviteDto>((i) => ({ id: i.id, email: i.email, role: i.role as OrgRole, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() })),
    limits: { members: ent.limits.orgMembers },
  };
}

export async function updateOrg(actor: Actor, orgId: string, input: Partial<z.infer<typeof orgNameSchema>> & { timezone?: string }, ip?: string) {
  const { me } = await loadOrg(actor, orgId);
  assertManage(me);
  const org = await db.organization.update({ where: { id: orgId }, data: { ...(input.name ? { name: input.name } : {}), ...(input.timezone ? { timezone: input.timezone } : {}) } });
  await audit({ actorType: "user", actorId: actor.user.id, action: "org.updated", targetType: "org", targetId: orgId, ip });
  return toOrgDto(org, me.role as OrgRole);
}

/** Deletes the organization and every file in it. Only the owner, and only after typing the organization's name. */
export async function deleteOrg(actor: Actor, orgId: string, confirmName: string, ip?: string) {
  const { org, me } = await loadOrg(actor, orgId);
  if (me.role !== "owner") throw Errors.forbidden("Only the owner can delete an organization.");
  if (confirmName.trim() !== org.name) throw Errors.validation("Type the organization's name to confirm.", [{ path: "confirm", message: "That doesn't match the organization's name." }]);
  for (;;) {
    const batch = await db.file.findMany({ where: { orgId }, take: 500 });
    if (!batch.length) break;
    await destroyFiles(batch);
  }
  const requests = await db.fileRequest.findMany({ where: { orgId, logoKey: { not: null } }, select: { logoKey: true } });
  for (const r of requests) if (r.logoKey) await storage().delete(r.logoKey).catch(() => undefined);
  await db.organization.delete({ where: { id: orgId } });
  await audit({ actorType: "user", actorId: actor.user.id, action: "org.deleted", targetType: "org", targetId: orgId, ip, metadata: { name: org.name } });
}

export async function inviteMember(actor: Actor, orgId: string, input: z.infer<typeof inviteSchema>, ip?: string) {
  const { org, me } = await loadOrg(actor, orgId);
  assertManage(me);
  if (me.role === "admin" && input.role === "admin") throw Errors.forbidden("Only the owner can invite admins.");
  rate.enforce(`org-invite:${actor.user.id}`, { limit: 30, windowSec: 3600 }, "You've sent many invitations recently. Try again later.");
  const ent = await entitlementsForOrg(org);
  const [members, pending] = await Promise.all([db.organizationMember.count({ where: { orgId } }), db.organizationInvite.count({ where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() } } })]);
  assertLimit(ent, "orgMembers", members + pending);
  const existingUser = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existingUser && (await db.organizationMember.findUnique({ where: { orgId_userId: { orgId, userId: existingUser.id } } }))) throw Errors.conflict("That person is already a member.");
  await db.organizationInvite.deleteMany({ where: { orgId, email: input.email, acceptedAt: null } });
  const token = newSecretToken(32);
  const invite = await db.organizationInvite.create({
    data: { id: newId("inv"), orgId, email: input.email, role: input.role, tokenHash: hashToken(token), invitedById: actor.user.id, expiresAt: new Date(Date.now() + 7 * 86400_000) },
  });
  const link = `${env.appUrl}/invite/${token}`;
  await queueEmail({ userId: existingUser?.id ?? null, to: input.email, template: "org_invite", subject: `${actor.user.displayName} invited you to ${org.name} on Cairn`, body: `${actor.user.displayName} invited you to join “${org.name}” as ${input.role}.\n\nAccept: ${link}\n\nThe link works for 7 days and only for the account that uses ${input.email}.` });
  if (existingUser) await notify({ userId: existingUser.id, type: "org_invite", title: `Invitation to ${org.name}`, body: `${actor.user.displayName} invited you as ${input.role}.`, href: `/invite/${token}` });
  await audit({ actorType: "user", actorId: actor.user.id, action: "org.member_invited", targetType: "org", targetId: orgId, ip, metadata: { role: input.role } });
  // The link is also returned so an owner can share it directly when no email provider is set up.
  return { invite: { id: invite.id, email: invite.email, role: invite.role as OrgRole, expiresAt: invite.expiresAt.toISOString(), createdAt: invite.createdAt.toISOString() } as InviteDto, link };
}

export async function revokeInvite(actor: Actor, orgId: string, inviteId: string) {
  const { me } = await loadOrg(actor, orgId);
  assertManage(me);
  const { count } = await db.organizationInvite.deleteMany({ where: { id: inviteId, orgId } });
  if (!count) throw Errors.notFound("That invitation doesn't exist.");
}

export async function describeInvite(token: string) {
  const invite = await db.organizationInvite.findUnique({ where: { tokenHash: hashToken(token) }, include: { org: { select: { name: true } } } });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= Date.now()) throw Errors.gone("This invitation is invalid or has expired.");
  return { orgName: invite.org.name, role: invite.role as OrgRole, email: invite.email };
}

export async function acceptInvite(actor: Actor, token: string, ip?: string): Promise<OrgDto> {
  rate.enforce(`invite-accept:${actor.user.id}`, { limit: 20, windowSec: 3600 });
  const invite = await db.organizationInvite.findUnique({ where: { tokenHash: hashToken(token) }, include: { org: true } });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= Date.now()) throw Errors.gone("This invitation is invalid or has expired.");
  if (invite.email.toLowerCase() !== actor.user.email.toLowerCase()) throw Errors.forbidden(`This invitation was sent to ${invite.email}. Sign in with that address to accept it.`);
  const ent = await entitlementsForOrg(invite.org);
  assertLimit(ent, "orgMembers", await db.organizationMember.count({ where: { orgId: invite.orgId } }));
  const claimed = await db.organizationInvite.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
  if (claimed.count !== 1) throw Errors.gone("This invitation has already been used.");
  await db.organizationMember.upsert({
    where: { orgId_userId: { orgId: invite.orgId, userId: actor.user.id } },
    create: { id: newId("mem"), orgId: invite.orgId, userId: actor.user.id, role: invite.role, invitedById: invite.invitedById },
    update: {},
  });
  await audit({ actorType: "user", actorId: actor.user.id, action: "org.member_joined", targetType: "org", targetId: invite.orgId, ip });
  await notify({ userId: invite.org.ownerId, type: "org_invite", title: `${actor.user.displayName} joined ${invite.org.name}`, body: `They joined as ${invite.role}.`, href: `/organizations/${invite.orgId}` });
  return toOrgDto(invite.org, invite.role as OrgRole);
}

export async function changeMemberRole(actor: Actor, orgId: string, memberId: string, role: (typeof ROLES)[number], ip?: string) {
  const { me } = await loadOrg(actor, orgId);
  assertManage(me);
  const target = await db.organizationMember.findFirst({ where: { id: memberId, orgId } });
  if (!target) throw Errors.notFound("That member doesn't exist.");
  if (target.role === "owner") throw Errors.conflict("Transfer ownership instead of changing the owner's role.");
  if (RANK[me.role as OrgRole] <= RANK[target.role as OrgRole] || RANK[me.role as OrgRole] <= RANK[role]) throw Errors.forbidden("You can only manage roles below your own.");
  await db.organizationMember.update({ where: { id: memberId }, data: { role } });
  await audit({ actorType: "user", actorId: actor.user.id, action: "org.member_role_changed", targetType: "org", targetId: orgId, ip, metadata: { memberId, role } });
}

export async function removeMember(actor: Actor, orgId: string, memberId: string, ip?: string) {
  const { org, me } = await loadOrg(actor, orgId);
  const target = await db.organizationMember.findFirst({ where: { id: memberId, orgId } });
  if (!target) throw Errors.notFound("That member doesn't exist.");
  const leaving = target.userId === actor.user.id;
  if (target.role === "owner") throw Errors.conflict("The owner can't be removed. Transfer ownership first.");
  if (!leaving) {
    assertManage(me);
    if (RANK[me.role as OrgRole] <= RANK[target.role as OrgRole]) throw Errors.forbidden("You can only remove members below your own role.");
  }
  await db.organizationMember.delete({ where: { id: memberId } });
  await audit({ actorType: "user", actorId: actor.user.id, action: "org.member_removed", targetType: "org", targetId: orgId, ip, metadata: { memberId, left: leaving } });
  if (!leaving) await notify({ userId: target.userId, type: "org_invite", title: `You were removed from ${org.name}`, body: "You no longer have access to its files.", href: "/dashboard" });
}

export async function transferOwnership(actor: Actor, orgId: string, toUserId: string, ip?: string) {
  const { me } = await loadOrg(actor, orgId);
  if (me.role !== "owner") throw Errors.forbidden("Only the owner can transfer ownership.");
  const target = await db.organizationMember.findUnique({ where: { orgId_userId: { orgId, userId: toUserId } } });
  if (!target || target.userId === actor.user.id) throw Errors.notFound("Choose another member of this organization.");
  await db.$transaction([
    db.organizationMember.update({ where: { id: me.id }, data: { role: "admin" } }),
    db.organizationMember.update({ where: { id: target.id }, data: { role: "owner" } }),
    db.organization.update({ where: { id: orgId }, data: { ownerId: toUserId } }),
  ]);
  await audit({ actorType: "user", actorId: actor.user.id, action: "org.member_role_changed", targetType: "org", targetId: orgId, ip, metadata: { transferredTo: toUserId } });
  await notify({ userId: toUserId, type: "org_invite", title: "You now own an organization", body: "The previous owner transferred ownership to you.", href: `/organizations/${orgId}` });
}

/** Organization-level summary for the "organization activity / shared storage" views. */
export async function orgOverview(actor: Actor) {
  if (!actor.workspace.orgId) throw Errors.badRequest("Switch to an organization workspace first.");
  assertCan(actor, "read");
  const orgId = actor.workspace.orgId;
  const [byMember, files] = await Promise.all([
    db.file.groupBy({ by: ["ownerId"], where: { orgId, deletedAt: null }, _sum: { size: true }, _count: true }),
    db.file.count({ where: { orgId, deletedAt: null } }),
  ]);
  const users = await db.user.findMany({ where: { id: { in: byMember.map((b) => b.ownerId) } }, select: { id: true, displayName: true } });
  const names = new Map(users.map((u) => [u.id, u.displayName]));
  return {
    files,
    contributors: byMember.map((b) => ({ userId: b.ownerId, name: names.get(b.ownerId) ?? "Former member", files: b._count, bytes: Number(b._sum?.size ?? 0n) })).sort((a, b) => b.bytes - a.bytes),
  };
}
