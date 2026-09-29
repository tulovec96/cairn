import { z } from "zod";
import type { FileRequest, Folder } from "@prisma/client";
import { db } from "../db";
import { hashPassword, hmac, safeEqual, verifyPassword } from "../crypto";
import { Errors } from "../errors";
import { newId, newShareToken, isValidShareToken } from "../ids";
import * as rate from "../ratelimit";
import { readCookie } from "../http";
import { getSettings } from "../settings";
import { env } from "../env";
import { actorLabel, scopeOf, type Actor } from "./actor";
import { audit } from "./audit";
import { assertFeature, assertLimit } from "./entitlements";
import { assertFlag } from "./flags";
import { getOwnedFolder } from "./folders";
import { entitlementsForActor } from "./limits";
import { assertCan } from "./permissions";
import { parseJson } from "./serializers";
import { formatBytes } from "@/lib/format";

/**
 * File requests and upload portals let people who have no account send files into a folder. They are a
 * separate concept from accounts: the uploader never gets a session, only a per-upload key that can move
 * bytes for that one upload, and everything they send is checked against the request's limits and the
 * owner's plan.
 */

const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

export const requestSchema = z.object({
  kind: z.enum(["request", "portal"]).default("request"),
  name: z.string().trim().min(1, "Give the request a name.").max(100),
  description: z.string().trim().max(1000).default(""),
  folderId: z.string().max(40).nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).transform((s) => new Date(s)).nullable().optional(),
  maxFileBytes: z.number().int().min(1).nullable().optional(),
  maxFiles: z.number().int().min(1).max(1_000_000).nullable().optional(),
  maxTotalBytes: z.number().int().min(1).nullable().optional(),
  allowedExtensions: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9]{1,16}$/)).max(50).default([]),
  password: z.string().min(4).max(128).nullable().optional(),
  notifyOnUpload: z.boolean().default(true),
  brandName: z.string().trim().max(60).nullable().optional(),
  accent: z.string().regex(ACCENT_RE).nullable().optional(),
  welcomeMessage: z.string().trim().max(1000).nullable().optional(),
});
export type RequestInput = z.infer<typeof requestSchema>;

export interface FileRequestDto {
  id: string;
  kind: "request" | "portal";
  name: string;
  description: string;
  token: string;
  url: string;
  folderId: string | null;
  folderName: string | null;
  expiresAt: string | null;
  closedAt: string | null;
  state: "open" | "closed" | "expired" | "full";
  maxFileBytes: number | null;
  maxFiles: number | null;
  maxTotalBytes: number | null;
  allowedExtensions: string[];
  hasPassword: boolean;
  notifyOnUpload: boolean;
  uploadCount: number;
  totalBytes: number;
  brandName: string | null;
  accent: string | null;
  welcomeMessage: string | null;
  createdAt: string;
}

export const requestUrl = (token: string) => `${env.appUrl}/r/${token}`;

function stateOf(r: Pick<FileRequest, "closedAt" | "expiresAt" | "maxFiles" | "uploadCount" | "maxTotalBytes" | "totalBytes">): FileRequestDto["state"] {
  if (r.closedAt) return "closed";
  if (r.expiresAt && r.expiresAt.getTime() <= Date.now()) return "expired";
  if ((r.maxFiles != null && r.uploadCount >= r.maxFiles) || (r.maxTotalBytes != null && Number(r.totalBytes) >= Number(r.maxTotalBytes))) return "full";
  return "open";
}

const num = (v: bigint | null) => (v == null ? null : Number(v));

function toDto(r: FileRequest & { folder?: Pick<Folder, "name"> | null }): FileRequestDto {
  return {
    id: r.id,
    kind: r.kind as "request" | "portal",
    name: r.name,
    description: r.description,
    token: r.token,
    url: requestUrl(r.token),
    folderId: r.folderId,
    folderName: r.folder?.name ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    state: stateOf(r),
    maxFileBytes: num(r.maxFileBytes),
    maxFiles: r.maxFiles,
    maxTotalBytes: num(r.maxTotalBytes),
    allowedExtensions: parseJson<string[]>(r.allowedExtensions, []),
    hasPassword: !!r.passwordHash,
    notifyOnUpload: r.notifyOnUpload,
    uploadCount: r.uploadCount,
    totalBytes: Number(r.totalBytes),
    brandName: r.brandName,
    accent: r.accent,
    welcomeMessage: r.welcomeMessage,
    createdAt: r.createdAt.toISOString(),
  };
}

const mineWhere = (actor: Actor) => (actor.workspace.orgId ? { orgId: actor.workspace.orgId } : { ownerId: actor.user.id, orgId: null });

async function assertAllowed(actor: Actor, input: Partial<RequestInput>, kind: "request" | "portal") {
  const ent = await entitlementsForActor(actor);
  await assertFeature(ent, "fileRequests");
  if (kind === "portal") await assertFeature(ent, "portals");
  if (input.brandName || input.accent || input.welcomeMessage) await assertFeature(ent, "customBranding");
  if (input.maxFileBytes != null && ent.limits.maxFileBytes >= 0 && input.maxFileBytes > ent.limits.maxFileBytes) {
    throw Errors.validation(`Your plan allows files up to ${formatBytes(ent.limits.maxFileBytes)}.`, [{ path: "maxFileBytes", message: `At most ${formatBytes(ent.limits.maxFileBytes)}.` }]);
  }
  return ent;
}

export async function listRequests(actor: Actor): Promise<FileRequestDto[]> {
  await assertFlag("fileRequests");
  const rows = await db.fileRequest.findMany({ where: mineWhere(actor), orderBy: { createdAt: "desc" }, take: 200, include: { folder: { select: { name: true } } } });
  return rows.map(toDto);
}

export async function createRequest(actor: Actor, input: RequestInput, ip?: string): Promise<FileRequestDto> {
  await assertFlag("fileRequests");
  assertCan(actor, "share");
  const ent = await assertAllowed(actor, input, input.kind);
  const open = await db.fileRequest.count({ where: { ...mineWhere(actor), closedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  assertLimit(ent, "fileRequests", open);
  if (input.folderId) await getOwnedFolder(scopeOf(actor), input.folderId);
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now() + 60_000) throw Errors.validation("The expiry must be in the future.");
  const row = await db.fileRequest.create({
    data: {
      id: newId("req"),
      ownerId: actor.user.id,
      orgId: actor.workspace.orgId,
      kind: input.kind,
      name: input.name,
      description: input.description,
      token: newShareToken(),
      folderId: input.folderId ?? null,
      expiresAt: input.expiresAt ?? null,
      maxFileBytes: input.maxFileBytes != null ? BigInt(input.maxFileBytes) : null,
      maxFiles: input.maxFiles ?? null,
      maxTotalBytes: input.maxTotalBytes != null ? BigInt(input.maxTotalBytes) : null,
      allowedExtensions: JSON.stringify(input.allowedExtensions),
      passwordHash: input.password ? await hashPassword(input.password) : null,
      notifyOnUpload: input.notifyOnUpload,
      brandName: input.brandName?.trim() || null,
      accent: input.accent ?? null,
      welcomeMessage: input.welcomeMessage?.trim() || null,
    },
    include: { folder: { select: { name: true } } },
  });
  await audit({ ...actorLabel(actor), action: "request.created", targetType: "request", targetId: row.id, ip, metadata: { name: row.name, kind: row.kind } });
  return toDto(row);
}

async function ownedRequest(actor: Actor, id: string) {
  const r = await db.fileRequest.findFirst({ where: { id, ...mineWhere(actor) }, include: { folder: { select: { name: true } } } });
  if (!r) throw Errors.notFound("That request doesn't exist.");
  return r;
}

export const requestPatchSchema = requestSchema.partial().extend({ closed: z.boolean().optional() });

export async function updateRequest(actor: Actor, id: string, patch: z.infer<typeof requestPatchSchema>, ip?: string): Promise<FileRequestDto> {
  assertCan(actor, "share");
  const existing = await ownedRequest(actor, id);
  const ent = await assertAllowed(actor, patch, (patch.kind ?? existing.kind) as "request" | "portal");
  if (patch.folderId) await getOwnedFolder(scopeOf(actor), patch.folderId);
  if (patch.closed === false && existing.closedAt) {
    const open = await db.fileRequest.count({ where: { ...mineWhere(actor), closedAt: null, id: { not: id }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    assertLimit(ent, "fileRequests", open);
  }
  const row = await db.fileRequest.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
      ...(patch.maxFileBytes !== undefined ? { maxFileBytes: patch.maxFileBytes == null ? null : BigInt(patch.maxFileBytes) } : {}),
      ...(patch.maxFiles !== undefined ? { maxFiles: patch.maxFiles } : {}),
      ...(patch.maxTotalBytes !== undefined ? { maxTotalBytes: patch.maxTotalBytes == null ? null : BigInt(patch.maxTotalBytes) } : {}),
      ...(patch.allowedExtensions !== undefined ? { allowedExtensions: JSON.stringify(patch.allowedExtensions) } : {}),
      ...(patch.password !== undefined ? { passwordHash: patch.password ? await hashPassword(patch.password) : null } : {}),
      ...(patch.notifyOnUpload !== undefined ? { notifyOnUpload: patch.notifyOnUpload } : {}),
      ...(patch.brandName !== undefined ? { brandName: patch.brandName?.trim() || null } : {}),
      ...(patch.accent !== undefined ? { accent: patch.accent } : {}),
      ...(patch.welcomeMessage !== undefined ? { welcomeMessage: patch.welcomeMessage?.trim() || null } : {}),
      ...(patch.closed !== undefined ? { closedAt: patch.closed ? (existing.closedAt ?? new Date()) : null } : {}),
    },
    include: { folder: { select: { name: true } } },
  });
  await audit({ ...actorLabel(actor), action: patch.closed ? "request.closed" : "request.updated", targetType: "request", targetId: id, ip });
  return toDto(row);
}

export async function deleteRequest(actor: Actor, id: string, ip?: string): Promise<void> {
  assertCan(actor, "share");
  await ownedRequest(actor, id);
  await db.fileRequest.delete({ where: { id } });
  await audit({ ...actorLabel(actor), action: "request.closed", targetType: "request", targetId: id, ip, metadata: { deleted: true } });
}

// ---------------------------------------------------------------------------------------------
// Public side
// ---------------------------------------------------------------------------------------------

export interface PublicRequestDto {
  token: string;
  kind: "request" | "portal";
  name: string;
  description: string;
  ownerName: string;
  brandName: string | null;
  accent: string | null;
  welcomeMessage: string | null;
  requiresPassword: boolean;
  unlocked: boolean;
  state: FileRequestDto["state"];
  maxFileBytes: number | null;
  maxFiles: number | null;
  filesLeft: number | null;
  allowedExtensions: string[];
}

const UNLOCK_TTL_MS = 6 * 3600_000;
const cookieName = (token: string) => `cairn_ru_${token.slice(0, 10)}`;
const sig = (r: Pick<FileRequest, "id" | "passwordHash">, exp: number) => hmac(`request-unlock:${r.id}:${exp}:${r.passwordHash?.slice(-24) ?? ""}`);

export function requestUnlockCookie(r: FileRequest) {
  const exp = Date.now() + UNLOCK_TTL_MS;
  return { name: cookieName(r.token), value: `${exp}.${sig(r, exp)}`, maxAgeSec: UNLOCK_TTL_MS / 1000 };
}

export function isRequestUnlocked(req: Request, r: FileRequest): boolean {
  if (!r.passwordHash) return true;
  const raw = readCookie(req, cookieName(r.token));
  if (!raw) return false;
  const [expStr, s] = raw.split(".");
  const exp = Number(expStr);
  return Number.isFinite(exp) && exp > Date.now() && !!s && safeEqual(s, sig(r, exp));
}

export async function loadPublicRequest(token: string) {
  if (!isValidShareToken(token)) throw Errors.notFound("This upload page doesn't exist.");
  await assertFlag("fileRequests");
  const r = await db.fileRequest.findUnique({ where: { token }, include: { owner: { select: { displayName: true, status: true } } } });
  if (!r || r.owner.status !== "active") throw Errors.notFound("This upload page doesn't exist.");
  return r;
}

export async function describeRequest(req: Request, token: string): Promise<PublicRequestDto> {
  const r = await loadPublicRequest(token);
  const unlocked = isRequestUnlocked(req, r);
  const state = stateOf(r);
  return {
    token,
    kind: r.kind as "request" | "portal",
    name: r.name,
    description: unlocked ? r.description : "",
    ownerName: r.owner.displayName,
    brandName: r.brandName,
    accent: r.accent,
    welcomeMessage: unlocked ? r.welcomeMessage : null,
    requiresPassword: !!r.passwordHash,
    unlocked,
    state,
    maxFileBytes: num(r.maxFileBytes),
    maxFiles: r.maxFiles,
    filesLeft: r.maxFiles == null ? null : Math.max(0, r.maxFiles - r.uploadCount),
    allowedExtensions: parseJson<string[]>(r.allowedExtensions, []),
  };
}

export async function tryUnlockRequest(r: FileRequest, password: string, ip: string): Promise<boolean> {
  const settings = await getSettings();
  rate.enforce([`req-unlock:${r.id}:${ip}`, `req-unlock-all:${r.id}`], settings.rateLimits.shareUnlock, "Too many password attempts. Try again later.");
  if (!r.passwordHash) return true;
  const ok = await verifyPassword(password, r.passwordHash);
  if (ok) rate.reset(`req-unlock:${r.id}:${ip}`);
  return ok;
}
