import { isIP } from "node:net";
import type { File as FileRow, Folder, Prisma, ShareLink, User } from "@prisma/client";
import { db } from "../db";
import { hashPassword, hmac, safeEqual, verifyPassword } from "../crypto";
import { Errors } from "../errors";
import { emit } from "../events";
import { readCookie } from "../http";
import { isValidShareToken, newId, newShareToken } from "../ids";
import * as rate from "../ratelimit";
import { getSettings } from "../settings";
import { audit } from "./audit";
import { actorLabel, scopeOf, workspaceIdOf, type Actor } from "./actor";
import { assertFlag } from "./flags";
import { assertFeature, entitlementsForActor } from "./limits";
import { getOwnedFolder } from "./folders";
import { notify } from "./notifications";
import { assertCan } from "./permissions";
import { serializeShare, shareState, sharePermissions, parseJson } from "./serializers";
import type { ShareDto, SharePermission } from "@/lib/types";

export interface ShareInput {
  fileId?: string;
  folderId?: string;
  password?: string | null;
  expiresAt?: Date | null;
  maxDownloads?: number | null;
  maxViews?: number | null;
  permissions?: SharePermission[];
  ipAllowlist?: string[];
  title?: string | null;
  message?: string | null;
  showSha256?: boolean;
  embedEnabled?: boolean;
}

const UNLOCK_TTL_MS = 6 * 3600_000;
const IP_ENTRY = /^(?:\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?|[0-9a-fA-F:]+)$/;

/** Validates allow-list entries (exact IPs, IPv4 CIDR blocks). */
export function normalizeIpAllowlist(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list.slice(0, 50)) {
    const entry = raw.trim();
    if (!entry) continue;
    const [ip, bits] = entry.split("/");
    if (!IP_ENTRY.test(entry) || !isIP(ip) || (bits !== undefined && (isIP(ip) !== 4 || Number(bits) < 0 || Number(bits) > 32))) throw Errors.validation(`"${entry}" isn't a valid IP address or CIDR block.`);
    out.push(entry);
  }
  return out;
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

export function ipAllowed(list: string[], ip: string): boolean {
  if (!list.length) return true;
  const clean = ip.replace(/^::ffff:/, "");
  for (const entry of list) {
    const [base, bits] = entry.split("/");
    if (bits === undefined) {
      if (base === clean) return true;
    } else if (isIP(clean) === 4) {
      const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
      if ((ipv4ToInt(clean) & mask) === (ipv4ToInt(base) & mask)) return true;
    }
  }
  return false;
}

async function assertShareFeatures(actor: Actor, input: Pick<ShareInput, "maxDownloads" | "maxViews" | "permissions" | "ipAllowlist" | "title" | "message" | "embedEnabled">) {
  const ent = await entitlementsForActor(actor);
  if (input.maxDownloads || input.maxViews) await assertFeature(ent, "shareLimits");
  if ((input.permissions && !input.permissions.includes("download")) || input.ipAllowlist?.length) await assertFeature(ent, "sharePermissions");
  if (input.title || input.message) await assertFeature(ent, "customBranding");
  if (input.embedEnabled) await assertFeature(ent, "embeds");
}

/** Shares that belong to the workspace the actor is in. */
function shareScopeWhere(actor: Actor): Prisma.ShareLinkWhereInput {
  return actor.workspace.orgId
    ? { OR: [{ file: { orgId: actor.workspace.orgId } }, { folder: { orgId: actor.workspace.orgId } }] }
    : { ownerId: actor.user.id, AND: [{ OR: [{ file: { orgId: null } }, { folder: { orgId: null } }] }] };
}

export async function createShare(actor: Actor, input: ShareInput, ip?: string): Promise<ShareDto> {
  await assertFlag("sharing");
  assertCan(actor, "share");
  if (!input.fileId === !input.folderId) throw Errors.validation("Choose exactly one file or folder to share.");
  const settings = await getSettings();
  rate.enforce(`share-create:${actor.user.id}`, settings.rateLimits.shareCreate);
  await assertShareFeatures(actor, input);
  const allow = input.ipAllowlist ? normalizeIpAllowlist(input.ipAllowlist) : [];
  const scope = scopeOf(actor);

  let targetName: string;
  let fileRow: FileRow | null = null;
  if (input.fileId) {
    fileRow = await db.file.findFirst({ where: { id: input.fileId, ...(scope.orgId ? { orgId: scope.orgId } : { ownerId: scope.userId, orgId: null }), deletedAt: null } });
    if (!fileRow) throw Errors.notFound();
    if (fileRow.status === "quarantined") throw Errors.quarantined();
    targetName = fileRow.originalName;
  } else {
    targetName = (await getOwnedFolder(scope, input.folderId!)).name;
  }
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now() + 30_000) throw Errors.validation("The link expiry must be in the future.");

  const perms = input.permissions?.length ? [...new Set(input.permissions)] : (["view", "download"] as SharePermission[]);
  if (!perms.includes("view")) perms.unshift("view");
  const share = await db.shareLink.create({
    data: {
      id: newId("shr"),
      token: newShareToken(),
      fileId: input.fileId ?? null,
      folderId: input.folderId ?? null,
      ownerId: actor.user.id,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      permissions: perms.join(","),
      title: input.title?.trim().slice(0, 120) || null,
      message: input.message?.trim().slice(0, 1000) || null,
      expiresAt: input.expiresAt ?? null,
      maxDownloads: input.maxDownloads ?? null,
      maxViews: input.maxViews ?? null,
      ipAllowlist: allow.length ? JSON.stringify(allow) : null,
      showSha256: input.showSha256 ?? true,
      embedEnabled: input.embedEnabled ?? false,
    },
  });
  await audit({ ...actorLabel(actor), action: "share.created", targetType: input.fileId ? "file" : "folder", targetId: input.fileId ?? input.folderId, ip, metadata: { shareId: share.id, protected: !!share.passwordHash } });
  await emit({ type: "share.created", workspaceId: workspaceIdOf(scope), ownerId: actor.user.id, orgId: scope.orgId, actorId: actor.user.id, actorLabel: actor.user.displayName, fileId: input.fileId ?? null, folderId: input.folderId ?? null, targetName, data: { shareId: share.id, token: share.token } });
  return serializeShare(share, targetName);
}

async function ownedShare(actor: Actor, id: string) {
  const share = await db.shareLink.findFirst({ where: { id, ...shareScopeWhere(actor) }, include: { file: true, folder: true } });
  if (!share) throw Errors.notFound();
  return share;
}

export interface ShareUpdate {
  password?: string | null;
  expiresAt?: Date | null;
  maxDownloads?: number | null;
  maxViews?: number | null;
  permissions?: SharePermission[];
  ipAllowlist?: string[];
  title?: string | null;
  message?: string | null;
  showSha256?: boolean;
  embedEnabled?: boolean;
}

export async function updateShare(actor: Actor, id: string, patch: ShareUpdate, ip?: string): Promise<ShareDto> {
  assertCan(actor, "share");
  const share = await ownedShare(actor, id);
  if (share.revokedAt) throw Errors.conflict("This link was revoked. Create a new one instead.");
  if (patch.expiresAt && patch.expiresAt.getTime() <= Date.now() + 30_000) throw Errors.validation("The link expiry must be in the future.");
  await assertShareFeatures(actor, patch);
  const allow = patch.ipAllowlist ? normalizeIpAllowlist(patch.ipAllowlist) : undefined;
  let permissions: string | undefined;
  if (patch.permissions) {
    const perms = [...new Set(patch.permissions)];
    if (!perms.includes("view")) perms.unshift("view");
    permissions = perms.join(",");
  }
  const updated = await db.shareLink.update({
    where: { id },
    data: {
      ...(patch.password !== undefined ? { passwordHash: patch.password ? await hashPassword(patch.password) : null } : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
      ...(patch.maxDownloads !== undefined ? { maxDownloads: patch.maxDownloads } : {}),
      ...(patch.maxViews !== undefined ? { maxViews: patch.maxViews } : {}),
      ...(permissions ? { permissions } : {}),
      ...(allow !== undefined ? { ipAllowlist: allow.length ? JSON.stringify(allow) : null } : {}),
      ...(patch.title !== undefined ? { title: patch.title?.trim().slice(0, 120) || null } : {}),
      ...(patch.message !== undefined ? { message: patch.message?.trim().slice(0, 1000) || null } : {}),
      ...(patch.showSha256 !== undefined ? { showSha256: patch.showSha256 } : {}),
      ...(patch.embedEnabled !== undefined ? { embedEnabled: patch.embedEnabled } : {}),
    },
  });
  await audit({ ...actorLabel(actor), action: "share.updated", targetType: "share", targetId: id, ip });
  return serializeShare(updated, share.file?.originalName ?? share.folder?.name);
}

export async function revokeShare(actor: Actor, id: string, ip?: string): Promise<ShareDto> {
  assertCan(actor, "share");
  const share = await ownedShare(actor, id);
  const updated = share.revokedAt ? share : await db.shareLink.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit({ ...actorLabel(actor), action: "share.revoked", targetType: "share", targetId: id, ip });
  const scope = scopeOf(actor);
  await emit({ type: "share.revoked", workspaceId: workspaceIdOf(scope), ownerId: actor.user.id, orgId: scope.orgId, actorId: actor.user.id, actorLabel: actor.user.displayName, fileId: share.fileId, folderId: share.folderId, targetName: share.file?.originalName ?? share.folder?.name, data: { shareId: id } });
  return serializeShare(updated, share.file?.originalName ?? share.folder?.name);
}

export async function deleteShare(actor: Actor, id: string, ip?: string): Promise<void> {
  assertCan(actor, "share");
  const share = await ownedShare(actor, id);
  await db.shareLink.delete({ where: { id } });
  await audit({ ...actorLabel(actor), action: "share.deleted", targetType: "share", targetId: id, ip });
  const scope = scopeOf(actor);
  await emit({ type: "share.deleted", workspaceId: workspaceIdOf(scope), ownerId: actor.user.id, orgId: scope.orgId, actorId: actor.user.id, actorLabel: actor.user.displayName, fileId: share.fileId, folderId: share.folderId, targetName: share.file?.originalName ?? share.folder?.name, data: { shareId: id } });
}

/** Revoke every active share of the given files (used when a file is quarantined by the system). */
export async function revokeSharesForFiles(fileIds: string[], reason: string) {
  if (!fileIds.length) return;
  const shares = await db.shareLink.findMany({ where: { fileId: { in: fileIds }, revokedAt: null }, include: { file: { select: { originalName: true } } } });
  if (!shares.length) return;
  await db.shareLink.updateMany({ where: { id: { in: shares.map((s) => s.id) } }, data: { revokedAt: new Date() } });
  const perOwner = new Map<string, string[]>();
  for (const s of shares) perOwner.set(s.ownerId, [...(perOwner.get(s.ownerId) ?? []), s.file?.originalName ?? "a file"]);
  for (const [userId, names] of perOwner) {
    await notify({ userId, type: "share_revoked", title: "Share links were revoked", body: `${names.length === 1 ? names[0] : `${names.length} files`}: ${reason}`, href: "/shared" });
  }
}

export async function listShares(actor: Actor): Promise<ShareDto[]> {
  const rows = await db.shareLink.findMany({
    where: shareScopeWhere(actor),
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { file: { select: { originalName: true, deletedAt: true } }, folder: { select: { name: true, deletedAt: true } } },
  });
  return rows.filter((s) => !s.file?.deletedAt && !s.folder?.deletedAt).map((s) => serializeShare(s, s.file?.originalName ?? s.folder?.name));
}

// ---------------------------------------------------------------------------------------------
// Analytics (what happened and when, never who)
// ---------------------------------------------------------------------------------------------

export async function recordShareEvent(shareId: string, type: "view" | "download", opts: { bytes?: number; referrer?: string | null } = {}): Promise<void> {
  let host: string | null = null;
  if (opts.referrer) {
    try {
      host = new URL(opts.referrer).host.slice(0, 120);
    } catch {
      host = null;
    }
  }
  await db.shareEvent.create({ data: { id: newId("shv"), shareId, type, bytes: opts.bytes != null ? BigInt(opts.bytes) : null, referrer: host } });
}

export async function shareAnalytics(actor: Actor, id: string, days = 30) {
  const share = await ownedShare(actor, id);
  const since = new Date(Date.now() - days * 86400_000);
  const events = await db.shareEvent.findMany({ where: { shareId: id, createdAt: { gte: since } }, select: { type: true, bytes: true, referrer: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 20_000 });
  const perDay = new Map<string, { views: number; downloads: number; bytes: number }>();
  const referrers = new Map<string, number>();
  for (const e of events) {
    const day = e.createdAt.toISOString().slice(0, 10);
    const row = perDay.get(day) ?? { views: 0, downloads: 0, bytes: 0 };
    if (e.type === "view") row.views++;
    else {
      row.downloads++;
      row.bytes += Number(e.bytes ?? 0n);
    }
    perDay.set(day, row);
    if (e.referrer) referrers.set(e.referrer, (referrers.get(e.referrer) ?? 0) + 1);
  }
  return {
    share: serializeShare(share, share.file?.originalName ?? share.folder?.name),
    totals: { views: share.viewCount, downloads: share.downloadCount, lastAccessedAt: share.lastAccessedAt?.toISOString() ?? null, transferBytes: [...perDay.values()].reduce((n, r) => n + r.bytes, 0) },
    daily: [...perDay.entries()].map(([day, v]) => ({ day, ...v })),
    referrers: [...referrers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([host, count]) => ({ host, count })),
  };
}

// ---------------------------------------------------------------------------------------------
// Public resolution
// ---------------------------------------------------------------------------------------------

export type ResolvedShare = {
  share: ShareLink;
  file: FileRow | null;
  folder: Folder | null;
  owner: Pick<User, "id" | "status" | "displayName" | "planKey" | "quotaBytes" | "maxFileBytes">;
};

/** Loads a share by token and enforces every "is this link usable" rule. */
/**
 * `forPage` is set when a visitor opens the share page (a "view"): only then does a used-up view limit block.
 * Previews and downloads on an already-open page keep working; downloads are limited by the download limit.
 */
export async function resolveShare(token: string, opts?: { allowExhausted?: boolean; ip?: string; forPage?: boolean }): Promise<ResolvedShare> {
  if (!isValidShareToken(token)) throw Errors.notFound("This link doesn't exist.");
  await assertFlag("sharing");
  const share = await db.shareLink.findUnique({
    where: { token },
    include: { file: true, folder: true, owner: { select: { id: true, status: true, displayName: true, planKey: true, quotaBytes: true, maxFileBytes: true } } },
  });
  if (!share) throw Errors.notFound("This link doesn't exist.");
  const state = shareState(share);
  const downloadsUsedUp = share.maxDownloads != null && share.downloadCount >= share.maxDownloads;
  const viewsUsedUp = share.maxViews != null && share.viewCount >= share.maxViews;
  if (state === "revoked" || state === "expired") throw Errors.gone("This link has expired or was removed.");
  if (!opts?.allowExhausted && (downloadsUsedUp || (opts?.forPage && viewsUsedUp))) throw Errors.gone("This link has reached its limit.");
  if (share.owner.status !== "active") throw Errors.gone();
  if (share.file) {
    if (share.file.deletedAt) throw Errors.gone();
    if (share.file.expiresAt && share.file.expiresAt.getTime() <= Date.now()) throw Errors.gone("This file has expired.");
  } else if (share.folder) {
    if (share.folder.deletedAt) throw Errors.gone();
  } else {
    throw Errors.notFound();
  }
  const allow = parseJson<string[]>(share.ipAllowlist, []);
  if (allow.length && opts?.ip && !ipAllowed(allow, opts.ip)) throw Errors.forbidden("This link can't be opened from your network.");
  return { share, file: share.file, folder: share.folder, owner: share.owner };
}

export function canDownload(share: ShareLink): boolean {
  return sharePermissions(share).includes("download");
}

function unlockCookieName(token: string): string {
  return `cairn_su_${token.slice(0, 10)}`;
}

function unlockSignature(share: ShareLink, exp: number): string {
  return hmac(`share-unlock:${share.id}:${exp}:${share.passwordHash?.slice(-24) ?? ""}`);
}

export function unlockCookieFor(share: ShareLink): { name: string; value: string; maxAgeSec: number } {
  const exp = Date.now() + UNLOCK_TTL_MS;
  return { name: unlockCookieName(share.token), value: `${exp}.${unlockSignature(share, exp)}`, maxAgeSec: UNLOCK_TTL_MS / 1000 };
}

export function isShareUnlocked(req: Request, share: ShareLink): boolean {
  if (!share.passwordHash) return true;
  const raw = readCookie(req, unlockCookieName(share.token));
  if (!raw) return false;
  const [expStr, sig] = raw.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false;
  return safeEqual(sig, unlockSignature(share, exp));
}

export function assertShareUnlocked(req: Request, share: ShareLink) {
  if (!isShareUnlocked(req, share)) throw Errors.passwordRequired();
}

/** Checks a password attempt. Failed attempts are rate limited per IP+share and per share overall. */
export async function tryUnlockShare(share: ShareLink, password: string, ip: string): Promise<boolean> {
  const settings = await getSettings();
  rate.enforce([`share-unlock:${share.id}:${ip}`, `share-unlock-all:${share.id}`], settings.rateLimits.shareUnlock, "Too many password attempts. Try again later.");
  if (!share.passwordHash) return true;
  const ok = await verifyPassword(password, share.passwordHash);
  if (ok) rate.reset(`share-unlock:${share.id}:${ip}`);
  return ok;
}

/** Atomically counts a download against the share's limit. Returns false when the limit is already reached. */
export async function consumeShareDownload(share: Pick<ShareLink, "id" | "maxDownloads">): Promise<boolean> {
  const { count } = await db.shareLink.updateMany({
    where: { id: share.id, ...(share.maxDownloads != null ? { downloadCount: { lt: share.maxDownloads }, maxDownloads: share.maxDownloads } : {}) },
    data: { downloadCount: { increment: 1 }, lastAccessedAt: new Date() },
  });
  return count > 0;
}

/** Counts a page view (once per page load) against the link's view limit. */
export async function consumeShareView(share: Pick<ShareLink, "id" | "maxViews">): Promise<boolean> {
  const { count } = await db.shareLink.updateMany({
    where: { id: share.id, ...(share.maxViews != null ? { viewCount: { lt: share.maxViews }, maxViews: share.maxViews } : {}) },
    data: { viewCount: { increment: 1 }, lastAccessedAt: new Date() },
  });
  return count > 0;
}
