import type { User } from "@prisma/client";
import { db } from "../db";
import { hashToken } from "../crypto";
import { Errors } from "../errors";
import { SESSION_COOKIE, WORKSPACE_COOKIE, assertSameOrigin, readCookie } from "../http";
import { newId, newSecretToken } from "../ids";
import { getSettings } from "../settings";
import { deviceLabelFrom } from "@/lib/device";
import { SCOPES } from "@/lib/types";

export type OrgRole = "owner" | "admin" | "member" | "viewer";

/** Where the caller is currently working: their personal files, or an organization they belong to. */
export interface Workspace {
  orgId: string | null;
  role: OrgRole | null;
  orgName?: string;
}

export type Actor = {
  kind: "user";
  user: User;
  via: "session" | "apikey";
  sessionId?: string;
  apiKeyId?: string;
  scopes: ReadonlySet<string>;
  workspace: Workspace;
};
export type UserActor = Actor;

export const API_KEY_PREFIX = "cairn_";
const ALL_SCOPES: ReadonlySet<string> = new Set(SCOPES);
const TOUCH_INTERVAL_MS = 5 * 60_000;
const PERSONAL: Workspace = { orgId: null, role: null };

const g = globalThis as unknown as { __cairnKeyTouch?: Map<string, number> };
const keyTouch: Map<string, number> = (g.__cairnKeyTouch ??= new Map());

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const settings = await getSettings();
  const token = newSecretToken(32);
  const expiresAt = new Date(Date.now() + settings.sessions.ttlDays * 86400_000);
  const session = await db.session.create({
    data: {
      id: newId("ses"),
      userId,
      tokenHash: hashToken(token),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      deviceLabel: deviceLabelFrom(meta.userAgent ?? null).label,
      expiresAt,
    },
  });
  return { token, session, maxAgeSec: settings.sessions.ttlDays * 86400 };
}

async function lookupSession(token: string): Promise<Actor | null> {
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (session.user.status !== "active") throw Errors.suspended();
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const settings = await getSettings();
    await db.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(now + settings.sessions.ttlDays * 86400_000) } })
      .catch(() => undefined);
  }
  return { kind: "user", user: session.user, via: "session", sessionId: session.id, scopes: ALL_SCOPES, workspace: PERSONAL };
}

async function lookupApiKey(token: string): Promise<Actor | null> {
  if (!token.startsWith(API_KEY_PREFIX)) return null;
  const key = await db.apiKey.findUnique({ where: { keyHash: hashToken(token) }, include: { user: true } });
  if (!key || key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return null;
  if (key.user.status !== "active") throw Errors.suspended();
  const last = keyTouch.get(key.id) ?? 0;
  if (Date.now() - last > 60_000) {
    keyTouch.set(key.id, Date.now());
    await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  const scopes = new Set(key.scopes.split(",").filter(Boolean));
  return { kind: "user", user: key.user, via: "apikey", apiKeyId: key.id, scopes, workspace: PERSONAL };
}

/** Membership check for a requested organization workspace. Returns the personal workspace when not allowed (lenient) or throws (strict). */
export async function resolveWorkspace(userId: string, requestedOrgId: string | null | undefined, strict: boolean): Promise<Workspace> {
  if (!requestedOrgId) return PERSONAL;
  const member = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: requestedOrgId, userId } },
    include: { org: { select: { name: true } } },
  });
  if (!member) {
    if (strict) throw Errors.forbidden("You're not a member of that organization.");
    return PERSONAL;
  }
  return { orgId: member.orgId, role: member.role as OrgRole, orgName: member.org.name };
}

/** An actor for background work performed on a user's behalf (automations, imports). Refuses inactive accounts. */
export async function actorForBackgroundWork(userId: string, orgId: string | null = null): Promise<Actor> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "active") throw new Error("The account is not active.");
  return { kind: "user", user, via: "session", scopes: ALL_SCOPES, workspace: await resolveWorkspace(userId, orgId, true) };
}

export interface Credentials {
  bearer?: string | null;
  sessionToken?: string | null;
  workspaceHeader?: string | null;
  workspaceCookie?: string | null;
}

export async function resolveCredentials(c: Credentials): Promise<{ actor: Actor | null; viaCookie: boolean }> {
  let actor: Actor | null = null;
  let viaCookie = false;
  if (c.bearer) {
    actor = await lookupApiKey(c.bearer);
    if (!actor) throw Errors.unauthorized("The provided API credentials are not valid.");
  } else if (c.sessionToken) {
    actor = await lookupSession(c.sessionToken);
    viaCookie = !!actor;
  }
  if (!actor) return { actor: null, viaCookie: false };
  const requested = c.workspaceHeader || (viaCookie ? c.workspaceCookie : null);
  if (requested) actor.workspace = await resolveWorkspace(actor.user.id, requested, !!c.workspaceHeader);
  return { actor, viaCookie };
}

/** Resolves who is calling a route handler. Cookie-authenticated mutations are CSRF-checked. */
export async function resolveActor(req: Request): Promise<Actor | null> {
  const auth = req.headers.get("authorization");
  const bearer = auth && /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : null;
  const { actor, viaCookie } = await resolveCredentials({
    bearer,
    sessionToken: readCookie(req, SESSION_COOKIE),
    workspaceHeader: req.headers.get("x-cairn-workspace"),
    workspaceCookie: readCookie(req, WORKSPACE_COOKIE),
  });
  if (actor && viaCookie) assertSameOrigin(req);
  return actor;
}

export async function requireActor(req: Request): Promise<Actor> {
  const actor = await resolveActor(req);
  if (!actor) throw Errors.unauthorized();
  return actor;
}

/** `files:write` (modify) also covers uploading, so keys created before `files:upload` existed keep working. */
export function hasScope(actor: Actor, scope: string): boolean {
  if (actor.scopes.has(scope)) return true;
  return scope === "files:upload" && actor.scopes.has("files:write");
}

export function assertScope(actor: Actor, scope: string) {
  if (!hasScope(actor, scope)) throw Errors.forbidden(`This API key is missing the "${scope}" scope.`);
}

export async function requireUser(req: Request, scope?: string): Promise<Actor> {
  const actor = await requireActor(req);
  if (scope) assertScope(actor, scope);
  return actor;
}

/** Endpoints that manage credentials themselves must not be reachable with an API key. */
export async function requireSessionUser(req: Request): Promise<Actor> {
  const actor = await requireUser(req);
  if (actor.via !== "session") throw Errors.forbidden("This action requires signing in with a browser session.");
  return actor;
}

export async function requireAdmin(req: Request): Promise<Actor> {
  const actor = await requireSessionUser(req);
  if (actor.user.role !== "admin") throw Errors.forbidden("Administrator access is required.");
  return actor;
}

export function actorLabel(actor: Actor): { actorType: "user" | "api_key"; actorId: string } {
  return { actorType: actor.via === "apikey" ? "api_key" : "user", actorId: actor.user.id };
}

/** Prisma `where` fragment restricting a query to the workspace the actor is working in. */
export function ownerWhere(actor: Actor): { orgId: string } | { ownerId: string; orgId: null } {
  return actor.workspace.orgId ? { orgId: actor.workspace.orgId } : { ownerId: actor.user.id, orgId: null };
}

export interface Scope {
  userId: string;
  orgId: string | null;
}

export const scopeOf = (actor: Actor): Scope => ({ userId: actor.user.id, orgId: actor.workspace.orgId });
export const scopeWhere = (s: Scope): { orgId: string } | { ownerId: string; orgId: null } => (s.orgId ? { orgId: s.orgId } : { ownerId: s.userId, orgId: null });
export const workspaceIdOf = (s: Scope): string => s.orgId ?? s.userId;
