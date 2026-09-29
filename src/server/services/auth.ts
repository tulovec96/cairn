import { unlink } from "node:fs/promises";
import QRCode from "qrcode";
import sharp from "sharp";
import { z } from "zod";
import type { User } from "@prisma/client";
import { db } from "../db";
import { decryptSecret, encryptSecret, hashPassword, hashToken, sha256Hex, verifyDummyPassword, verifyPassword } from "../crypto";
import { env } from "../env";
import { Errors } from "../errors";
import { newId, newSecretToken, randomString } from "../ids";
import * as rate from "../ratelimit";
import { getSettings } from "../settings";
import { storage } from "../storage";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../totp";
import { deviceLabelFrom } from "@/lib/device";
import { createSession, type Actor } from "./actor";
import { audit } from "./audit";
import { queueEmail } from "./email";
import { destroyFiles } from "./files";
import { notify } from "./notifications";

export const emailSchema = z.string().trim().toLowerCase().min(3).max(254).email("Enter a valid email address.");

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "1234567890", "12345678910", "qwertyuiop", "qwerty12345", "iloveyou123", "letmein1234",
  "0123456789", "abcdefghij", "1q2w3e4r5t", "admin12345", "welcome1234",
]);

export function validatePassword(password: string, email?: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "That password is too long (200 characters max).";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "That password is too common. Pick something less guessable.";
  if (email && password.toLowerCase() === email.toLowerCase()) return "Your password can't be your email address.";
  if (/^(.)\1+$/.test(password)) return "Use a mix of different characters.";
  return null;
}

function assertPasswordOk(password: string, email: string, field = "password") {
  const problem = validatePassword(password, email);
  if (problem) throw Errors.validation(problem, [{ path: field, message: problem }]);
}

type Meta = { ip: string; userAgent: string | null };

// ---------------------------------------------------------------------------------------------
// One-time tokens (email verification, password reset, admin recovery)
// ---------------------------------------------------------------------------------------------

type TokenPurpose = "password_reset" | "email_verify" | "recovery";
const TOKEN_TTL_MS: Record<TokenPurpose, number> = { password_reset: 3600_000, email_verify: 3 * 86400_000, recovery: 24 * 3600_000 };

async function issueToken(userId: string, purpose: TokenPurpose): Promise<string> {
  const token = newSecretToken(32);
  // A new token replaces older unused ones for the same purpose.
  await db.authToken.deleteMany({ where: { userId, purpose, usedAt: null } });
  await db.authToken.create({ data: { id: newId("tok"), userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]) } });
  return token;
}

async function peekToken(token: string, purpose: TokenPurpose | TokenPurpose[]) {
  const purposes = Array.isArray(purpose) ? purpose : [purpose];
  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now() || !purposes.includes(row.purpose as TokenPurpose)) {
    throw Errors.badRequest("This link is invalid or has expired. Request a new one.");
  }
  return row;
}

async function consumeToken(token: string, purpose: TokenPurpose | TokenPurpose[]) {
  const row = await peekToken(token, purpose);
  const claimed = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw Errors.badRequest("This link has already been used.");
  return row;
}

export async function sendVerificationEmail(user: Pick<User, "id" | "email" | "displayName">) {
  const token = await issueToken(user.id, "email_verify");
  const link = `${env.appUrl}/verify-email?token=${token}`;
  await queueEmail({ userId: user.id, to: user.email, template: "verify_email", subject: "Confirm your email address", body: `Hi ${user.displayName},\n\nConfirm your email address for Cairn:\n${link}\n\nThe link works for 3 days. If you didn't create an account, ignore this message.` });
}

export async function verifyEmail(token: string): Promise<void> {
  const row = await consumeToken(token, "email_verify");
  await db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  await audit({ actorType: "user", actorId: row.userId, action: "auth.email_verified" });
}

export async function resendVerification(actor: Actor): Promise<void> {
  if (actor.user.emailVerifiedAt) return;
  rate.enforce(`verify-resend:${actor.user.id}`, { limit: 3, windowSec: 3600 }, "You can request up to 3 verification emails an hour.");
  await sendVerificationEmail(actor.user);
}

export const forgotSchema = z.object({ email: emailSchema });

/** Always answers the same way, so it can't be used to discover which addresses have accounts. */
export async function requestPasswordReset(email: string, meta: Meta): Promise<void> {
  const settings = await getSettings();
  rate.enforce(`pw-reset:${meta.ip}`, settings.rateLimits.passwordReset, "Too many reset requests. Try again later.");
  rate.enforce(`pw-reset-acct:${email}`, { limit: 3, windowSec: 3600 }, "Too many reset requests for this account. Try again later.");
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status !== "active") return;
  const token = await issueToken(user.id, "password_reset");
  const link = `${env.appUrl}/reset-password?token=${token}`;
  await queueEmail({ userId: user.id, to: user.email, template: "password_reset", subject: "Reset your password", body: `Hi ${user.displayName},\n\nSomeone (hopefully you) asked to reset your Cairn password:\n${link}\n\nThe link works for one hour and only once. If this wasn't you, ignore this message; your password is unchanged.` });
  await audit({ actorType: "user", actorId: user.id, action: "auth.password_reset", ip: meta.ip, metadata: { stage: "requested" } });
}

export const resetSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) });

export async function resetPassword(input: z.infer<typeof resetSchema>, meta: Meta): Promise<void> {
  const settings = await getSettings();
  rate.enforce(`pw-reset-use:${meta.ip}`, settings.rateLimits.passwordReset, "Too many attempts. Try again later.");
  // Validate the new password first: a rejected password must not burn the one-time link.
  const peeked = await peekToken(input.token, ["password_reset", "recovery"]);
  const user = await db.user.findUniqueOrThrow({ where: { id: peeked.userId } });
  assertPasswordOk(input.password, user.email);
  const row = await consumeToken(input.token, ["password_reset", "recovery"]);
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password), emailVerifiedAt: user.emailVerifiedAt ?? (row.purpose === "password_reset" ? new Date() : null) } });
  await db.session.deleteMany({ where: { userId: user.id } });
  await audit({ actorType: "user", actorId: user.id, action: "auth.password_reset", ip: meta.ip, metadata: { stage: "completed" } });
  await notify({ userId: user.id, type: "security_event", title: "Your password was reset", body: "All devices were signed out. If this wasn't you, contact support immediately.", href: "/settings/security" });
}

/** Admins can hand a locked-out user a one-time link (useful when no email provider is configured). */
export async function issueRecoveryLink(adminId: string, userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw Errors.notFound();
  const token = await issueToken(userId, "recovery");
  await audit({ actorType: "admin", actorId: adminId, action: "auth.password_reset", targetType: "user", targetId: userId, metadata: { stage: "admin_link" } });
  return `${env.appUrl}/reset-password?token=${token}`;
}

// ---------------------------------------------------------------------------------------------
// Registration & sign-in
// ---------------------------------------------------------------------------------------------

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  displayName: z.string().trim().max(60).optional(),
});

export async function registerUser(input: z.infer<typeof registerSchema>, meta: Meta) {
  const settings = await getSettings();
  rate.enforce(`register:${meta.ip}`, settings.rateLimits.register, "Too many sign-up attempts from this network. Try again later.");
  const userCount = await db.user.count();
  if (!settings.registration.enabled && userCount > 0) throw Errors.registrationClosed();

  assertPasswordOk(input.password, input.email);
  const existing = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw Errors.conflict("An account with this email already exists.", [{ path: "email", message: "An account with this email already exists." }]);

  const { ensureDefaultPlans, defaultPlanKey } = await import("./entitlements");
  await ensureDefaultPlans();
  const user = await db.user.create({
    data: {
      id: newId("usr"),
      email: input.email,
      displayName: input.displayName || input.email.split("@")[0].slice(0, 60),
      passwordHash: await hashPassword(input.password),
      role: userCount === 0 ? "admin" : "user",
      planKey: await defaultPlanKey(),
      lastLoginAt: new Date(),
    },
  });
  const session = await createSession(user.id, { ip: meta.ip, userAgent: meta.userAgent });
  await audit({ actorType: "user", actorId: user.id, action: "auth.register", targetType: "user", targetId: user.id, ip: meta.ip, metadata: { firstUser: userCount === 0 } });
  await sendVerificationEmail(user).catch(() => undefined);
  return { user, session };
}

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200), code: z.string().trim().max(40).optional() });

const g = globalThis as unknown as { __cairnTotpUsed?: Map<string, number> };
const usedTotpSteps: Map<string, number> = (g.__cairnTotpUsed ??= new Map());

/** Verifies a TOTP code or a one-time backup code. Backup codes are consumed; TOTP codes can't be replayed. */
async function verifySecondFactor(user: User, code: string): Promise<boolean> {
  if (!user.totpSecret) return false;
  const clean = code.replace(/[\s-]/g, "");
  if (/^\d{6}$/.test(clean)) {
    const step = verifyTotp(decryptSecret(user.totpSecret), clean);
    if (step === null) return false;
    if ((usedTotpSteps.get(user.id) ?? -1) >= step) return false;
    usedTotpSteps.set(user.id, step);
    return true;
  }
  const hashes: string[] = user.backupCodes ? JSON.parse(user.backupCodes) : [];
  const h = sha256Hex(`backup:${clean.toLowerCase()}`);
  const idx = hashes.indexOf(h);
  if (idx < 0) return false;
  hashes.splice(idx, 1);
  await db.user.update({ where: { id: user.id }, data: { backupCodes: JSON.stringify(hashes) } });
  return true;
}

export async function loginUser(input: z.infer<typeof loginSchema>, meta: Meta) {
  const settings = await getSettings();
  rate.enforce(`login-ip:${meta.ip}`, settings.rateLimits.login, "Too many sign-in attempts. Try again in a few minutes.");
  const acctKey = `login-fail:${input.email}`;
  const lockout = rate.remainingLockout(acctKey, settings.rateLimits.loginPerAccount);
  if (lockout > 0) throw Errors.rateLimited(lockout, "Too many failed attempts for this account. Try again later.");

  const user = await db.user.findUnique({ where: { email: input.email } });
  const ok = user ? await verifyPassword(input.password, user.passwordHash) : (await verifyDummyPassword(input.password), false);
  if (!user || !ok) {
    rate.hit(acctKey, settings.rateLimits.loginPerAccount);
    await audit({ actorType: "user", actorId: user?.id ?? null, action: "auth.login_failed", ip: meta.ip, metadata: { reason: "password" } });
    throw Errors.unauthorized("Incorrect email or password.");
  }
  if (user.status !== "active") throw Errors.suspended();
  if (user.totpEnabledAt) {
    if (!input.code) throw Errors.twoFactorRequired();
    if (!(await verifySecondFactor(user, input.code))) {
      rate.hit(acctKey, settings.rateLimits.loginPerAccount);
      await audit({ actorType: "user", actorId: user.id, action: "auth.login_failed", ip: meta.ip, metadata: { reason: "second_factor" } });
      throw Errors.invalidCode();
    }
  }
  rate.reset(acctKey);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const device = deviceLabelFrom(meta.userAgent).label;
  const known = await db.auditLog.findFirst({ where: { actorId: user.id, action: "auth.login", metadata: { contains: JSON.stringify(device).slice(1, -1) } }, select: { id: true } });
  const session = await createSession(user.id, { ip: meta.ip, userAgent: meta.userAgent });
  await audit({ actorType: "user", actorId: user.id, action: "auth.login", ip: meta.ip, metadata: { device } });
  if (!known && (await db.auditLog.count({ where: { actorId: user.id, action: "auth.login" } })) > 1) {
    await notify({ userId: user.id, type: "security_event", title: "New sign-in from a device we haven't seen", body: `${device}. If this wasn't you, change your password and revoke other sessions.`, href: "/settings/security", dedupeKey: `newdev:${device}`, dedupeHours: 24 * 30 });
  }
  return { user, session };
}

export async function logoutSession(sessionId: string) {
  await db.session.delete({ where: { id: sessionId } }).catch(() => undefined);
}

export async function changePassword(actor: Actor, current: string, next: string, ip?: string) {
  const settings = await getSettings();
  rate.enforce(`pw-change:${actor.user.id}`, settings.rateLimits.loginPerAccount, "Too many attempts. Try again later.");
  if (!(await verifyPassword(current, actor.user.passwordHash))) throw Errors.invalidPassword();
  assertPasswordOk(next, actor.user.email, "newPassword");
  await db.user.update({ where: { id: actor.user.id }, data: { passwordHash: await hashPassword(next) } });
  // Any other browser that had access must sign in again with the new password.
  await db.session.deleteMany({ where: { userId: actor.user.id, ...(actor.sessionId ? { id: { not: actor.sessionId } } : {}) } });
  await audit({ actorType: "user", actorId: actor.user.id, action: "auth.password_changed", ip });
  await notify({ userId: actor.user.id, type: "security_event", title: "Your password was changed", body: "Other devices were signed out.", href: "/settings/security" });
}

export async function changeEmail(actor: Actor, password: string, newEmail: string, ip?: string) {
  rate.enforce(`email-change:${actor.user.id}`, { limit: 5, windowSec: 3600 }, "Too many attempts. Try again later.");
  if (!(await verifyPassword(password, actor.user.passwordHash))) throw Errors.invalidPassword();
  const email = emailSchema.parse(newEmail);
  if (email === actor.user.email) return;
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw Errors.conflict("An account with this email already exists.", [{ path: "email", message: "An account with this email already exists." }]);
  const user = await db.user.update({ where: { id: actor.user.id }, data: { email, emailVerifiedAt: null } });
  await audit({ actorType: "user", actorId: user.id, action: "auth.email_changed", ip });
  await notify({ userId: user.id, type: "security_event", title: "Your email address was changed", body: `The account email is now ${email}.`, href: "/settings/security" });
  await sendVerificationEmail(user).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------
// Two-factor authentication
// ---------------------------------------------------------------------------------------------

function newBackupCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: 10 }, () => `${randomString(5).toLowerCase()}-${randomString(5).toLowerCase()}`);
  return { plain, hashes: plain.map((c) => sha256Hex(`backup:${c.replace("-", "")}`)) };
}

/** Backup codes are matched with the dash stripped, so both `abcde-fghij` and `abcdefghij` work. */
export async function beginTotpSetup(actor: Actor) {
  if (actor.user.totpEnabledAt) throw Errors.conflict("Two-factor authentication is already on.");
  const secret = generateTotpSecret();
  await db.user.update({ where: { id: actor.user.id }, data: { totpSecret: encryptSecret(secret) } });
  const uri = otpauthUri({ secret, account: actor.user.email, issuer: "Cairn" });
  return { secret, uri, qrSvg: await QRCode.toString(uri, { type: "svg", margin: 1, width: 192 }) };
}

export async function enableTotp(actor: Actor, code: string, ip?: string) {
  rate.enforce(`totp-enable:${actor.user.id}`, { limit: 10, windowSec: 900 }, "Too many attempts. Try again later.");
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.user.id } });
  if (user.totpEnabledAt) throw Errors.conflict("Two-factor authentication is already on.");
  if (!user.totpSecret) throw Errors.badRequest("Start the setup first.");
  if (verifyTotp(decryptSecret(user.totpSecret), code) === null) throw Errors.invalidCode();
  const codes = newBackupCodes();
  await db.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date(), backupCodes: JSON.stringify(codes.hashes) } });
  await audit({ actorType: "user", actorId: user.id, action: "auth.2fa_enabled", ip });
  await notify({ userId: user.id, type: "security_event", title: "Two-factor authentication turned on", body: "Sign-ins now need a code from your authenticator app.", href: "/settings/security" });
  return { backupCodes: codes.plain };
}

async function assertReauth(actor: Actor, password: string, code?: string) {
  rate.enforce(`reauth:${actor.user.id}`, { limit: 10, windowSec: 900 }, "Too many attempts. Try again later.");
  if (!(await verifyPassword(password, actor.user.passwordHash))) throw Errors.invalidPassword();
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.user.id } });
  if (user.totpEnabledAt) {
    if (!code) throw Errors.twoFactorRequired();
    if (!(await verifySecondFactor(user, code))) throw Errors.invalidCode();
  }
}

export async function disableTotp(actor: Actor, password: string, code: string | undefined, ip?: string) {
  await assertReauth(actor, password, code);
  await db.user.update({ where: { id: actor.user.id }, data: { totpSecret: null, totpEnabledAt: null, backupCodes: null } });
  await audit({ actorType: "user", actorId: actor.user.id, action: "auth.2fa_disabled", ip });
  await notify({ userId: actor.user.id, type: "security_event", title: "Two-factor authentication turned off", body: "If this wasn't you, change your password now.", href: "/settings/security" });
}

export async function regenerateBackupCodes(actor: Actor, password: string, code: string | undefined, ip?: string) {
  if (!actor.user.totpEnabledAt) throw Errors.badRequest("Turn on two-factor authentication first.");
  await assertReauth(actor, password, code);
  const codes = newBackupCodes();
  await db.user.update({ where: { id: actor.user.id }, data: { backupCodes: JSON.stringify(codes.hashes) } });
  await audit({ actorType: "user", actorId: actor.user.id, action: "auth.backup_codes_regenerated", ip });
  return { backupCodes: codes.plain };
}

export async function backupCodesRemaining(userId: string): Promise<number> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { backupCodes: true } });
  return u?.backupCodes ? (JSON.parse(u.backupCodes) as string[]).length : 0;
}

// ---------------------------------------------------------------------------------------------
// Profile & preferences
// ---------------------------------------------------------------------------------------------

export const LANGUAGES = [{ code: "en", label: "English" }] as const;

export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{3,30}$/, "Usernames are 3–30 characters: letters, digits, _ and -.").nullable().optional(),
  bio: z.string().trim().max(300).optional(),
  timezone: z.string().max(64).optional(),
  language: z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  prefs: z.record(z.string().max(40), z.unknown()).optional(),
  privacy: z.object({ showEmail: z.boolean().optional(), showProfile: z.boolean().optional() }).optional(),
});

const RESERVED_USERNAMES = new Set(["admin", "root", "support", "cairn", "system", "api", "help", "security", "www"]);

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function jsonObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export async function updateProfile(actor: Actor, input: z.infer<typeof profileSchema>): Promise<User> {
  const data: Record<string, unknown> = {};
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.bio !== undefined) data.bio = input.bio;
  if (input.theme !== undefined) data.theme = input.theme;
  if (input.language !== undefined) data.language = input.language;
  if (input.timezone !== undefined) {
    if (!validTimezone(input.timezone)) throw Errors.validation("That time zone isn't recognized.", [{ path: "timezone", message: "Choose a time zone from the list." }]);
    data.timezone = input.timezone;
  }
  if (input.username !== undefined) {
    if (input.username && RESERVED_USERNAMES.has(input.username)) throw Errors.validation("That username is reserved.", [{ path: "username", message: "That username is reserved." }]);
    if (input.username) {
      const taken = await db.user.findFirst({ where: { username: input.username, id: { not: actor.user.id } }, select: { id: true } });
      if (taken) throw Errors.conflict("That username is taken.", [{ path: "username", message: "That username is taken." }]);
    }
    data.username = input.username;
  }
  if (input.prefs) {
    const merged = { ...jsonObject(actor.user.prefs), ...input.prefs };
    const text = JSON.stringify(merged);
    if (text.length > 8000) throw Errors.validation("Preferences are too large.");
    data.prefs = text;
  }
  if (input.privacy) data.privacy = JSON.stringify({ ...jsonObject(actor.user.privacy), ...input.privacy });
  return db.user.update({ where: { id: actor.user.id }, data });
}

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Re-encodes the upload as a 256px WebP, which also strips metadata and neutralizes anything hostile in the original. */
export async function setAvatar(actor: Actor, bytes: Buffer): Promise<User> {
  if (bytes.length === 0) throw Errors.validation("Choose an image.");
  if (bytes.length > AVATAR_MAX_BYTES) throw Errors.tooLarge("Avatars can be up to 5 MB.");
  let out: Buffer;
  try {
    out = await sharp(bytes, { limitInputPixels: 50_000_000, failOn: "error" }).rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
  } catch {
    throw Errors.validation("That file isn't a supported image (JPEG, PNG, WebP, GIF or AVIF).");
  }
  const key = `avatars/${randomString(24).toLowerCase()}.webp`; // storage keys are lowercase; the owner is recorded on the user row
  const { Readable } = await import("node:stream");
  await storage().putStream(key, Readable.from(out));
  const old = actor.user.avatarKey;
  const user = await db.user.update({ where: { id: actor.user.id }, data: { avatarKey: key } });
  if (old) await storage().delete(old).catch(() => undefined);
  return user;
}

export async function removeAvatar(actor: Actor): Promise<User> {
  if (actor.user.avatarKey) await storage().delete(actor.user.avatarKey).catch(() => undefined);
  return db.user.update({ where: { id: actor.user.id }, data: { avatarKey: null } });
}

// ---------------------------------------------------------------------------------------------
// Sessions & login history
// ---------------------------------------------------------------------------------------------

export async function listSessions(userId: string, currentId?: string) {
  const rows = await db.session.findMany({ where: { userId, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
  return rows.map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    deviceLabel: s.deviceLabel ?? deviceLabelFrom(s.userAgent).label,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === currentId,
  }));
}

export async function loginHistory(userId: string, limit = 30) {
  const rows = await db.auditLog.findMany({ where: { actorId: userId, action: { in: ["auth.login", "auth.login_failed", "auth.password_changed", "auth.2fa_enabled", "auth.2fa_disabled", "auth.password_reset", "auth.email_changed"] } }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => {
    let meta: Record<string, unknown> = {};
    try {
      meta = r.metadata ? JSON.parse(r.metadata) : {};
    } catch {
      /* ignore */
    }
    return { id: r.id, action: r.action, ip: r.ip, device: typeof meta.device === "string" ? meta.device : null, reason: typeof meta.reason === "string" ? meta.reason : null, createdAt: r.createdAt.toISOString() };
  });
}

export async function revokeSession(userId: string, sessionId: string, ip?: string) {
  const { count } = await db.session.deleteMany({ where: { id: sessionId, userId } });
  if (!count) throw Errors.notFound("That session doesn't exist.");
  await audit({ actorType: "user", actorId: userId, action: "auth.session_revoked", targetType: "session", targetId: sessionId, ip });
}

export async function revokeOtherSessions(userId: string, currentId?: string, ip?: string) {
  const { count } = await db.session.deleteMany({ where: { userId, ...(currentId ? { id: { not: currentId } } : {}) } });
  await audit({ actorType: "user", actorId: userId, action: "auth.sessions_revoked_all", ip, metadata: { count } });
  return count;
}

// ---------------------------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------------------------

/**
 * Permanently deletes an account and everything it owns, including blobs in storage. Organizations the user
 * owns are handed to the longest-standing other member (admins first); organizations with nobody else are
 * deleted with their files. Files the user added to an organization stay with the organization.
 */
export async function purgeUserData(userId: string): Promise<{ files: number; orgsDeleted: number; orgsTransferred: number }> {
  let orgsDeleted = 0;
  let orgsTransferred = 0;
  const owned = await db.organization.findMany({ where: { ownerId: userId }, include: { members: { where: { userId: { not: userId } }, orderBy: { createdAt: "asc" } } } });
  for (const org of owned) {
    const heir = org.members.find((m) => m.role === "admin") ?? org.members.find((m) => m.role === "member") ?? org.members[0];
    if (heir) {
      await db.$transaction([
        db.organization.update({ where: { id: org.id }, data: { ownerId: heir.userId } }),
        db.organizationMember.update({ where: { id: heir.id }, data: { role: "owner" } }),
      ]);
      orgsTransferred++;
    } else {
      for (;;) {
        const batch = await db.file.findMany({ where: { orgId: org.id }, take: 500 });
        if (!batch.length) break;
        await destroyFiles(batch);
      }
      await db.organization.delete({ where: { id: org.id } });
      orgsDeleted++;
    }
  }
  // Files uploaded into organizations stay with the organization: hand them to its current owner.
  const contributed = await db.file.findMany({ where: { ownerId: userId, orgId: { not: null } }, select: { orgId: true }, distinct: ["orgId"] });
  for (const { orgId } of contributed) {
    const org = await db.organization.findUnique({ where: { id: orgId! }, select: { ownerId: true } });
    if (org) {
      await db.file.updateMany({ where: { ownerId: userId, orgId }, data: { ownerId: org.ownerId } });
      await db.folder.updateMany({ where: { ownerId: userId, orgId }, data: { ownerId: org.ownerId } });
    }
  }

  let files = 0;
  for (;;) {
    const batch = await db.file.findMany({ where: { ownerId: userId }, take: 500 });
    if (!batch.length) break;
    await destroyFiles(batch);
    files += batch.length;
  }
  const [archives, exportRows, user, requests] = await Promise.all([
    db.archiveJob.findMany({ where: { ownerId: userId } }),
    db.dataExport.findMany({ where: { userId } }),
    db.user.findUnique({ where: { id: userId }, select: { avatarKey: true } }),
    db.fileRequest.findMany({ where: { ownerId: userId, logoKey: { not: null } }, select: { logoKey: true } }),
  ]);
  for (const key of [...archives.map((a) => a.storageKey), ...exportRows.map((e) => e.storageKey), ...requests.map((r) => r.logoKey), user?.avatarKey]) if (key) await storage().delete(key).catch(() => undefined);
  const uploads = await db.upload.findMany({ where: { ownerId: userId, status: { in: ["active", "finalizing"] } } });
  for (const u of uploads) await unlink(u.stagingPath).catch(() => undefined);
  await db.user.delete({ where: { id: userId } });
  return { files, orgsDeleted, orgsTransferred };
}

export async function deleteAccount(actor: Actor, password: string, code: string | undefined, ip?: string) {
  await assertReauth(actor, password, code);
  if (actor.user.role === "admin") {
    const admins = await db.user.count({ where: { role: "admin", status: "active" } });
    if (admins <= 1) throw Errors.conflict("You are the only administrator. Promote another admin before deleting this account.");
  }
  const sharedOrgs = await db.organization.findMany({ where: { ownerId: actor.user.id, members: { some: { userId: { not: actor.user.id } } } }, select: { name: true } });
  if (sharedOrgs.length) throw Errors.conflict(`You own ${sharedOrgs.map((o) => `“${o.name}”`).join(", ")}, which still ${sharedOrgs.length === 1 ? "has" : "have"} other members. Transfer ownership or remove the members first.`);
  const result = await purgeUserData(actor.user.id);
  await audit({ actorType: "user", actorId: actor.user.id, action: "auth.account_deleted", targetType: "user", targetId: actor.user.id, ip, metadata: result });
}

export type { User };
