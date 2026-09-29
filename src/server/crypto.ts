import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual, type BinaryLike } from "node:crypto";
import { env } from "./env";

export function sha256Hex(data: BinaryLike): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Hash of a high-entropy random token (session ids, API keys). Not for passwords. */
export function hashToken(token: string): string {
  return sha256Hex(token);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still spend comparable time, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

// scrypt parameters: N=2^15 (32 MiB), r=8, p=1. OWASP-recommended minimum class.
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: 128 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  try {
    const expected = Buffer.from(keyB64, "base64");
    const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/** Burn the same CPU as a real verification so unknown accounts are not distinguishable by timing. */
export async function verifyDummyPassword(password: string): Promise<void> {
  dummyHash ??= hashPassword("cairn-dummy-password");
  await verifyPassword(password, await dummyHash);
}

export function hmac(data: string): string {
  return createHmac("sha256", env.secret).update(data).digest("base64url");
}

/** Hash used to correlate abuse/rate-limit data without storing raw IP addresses. */
export function fingerprint(value: string): string {
  return createHmac("sha256", env.secret).update(`fp:${value}`).digest("hex").slice(0, 32);
}

// ---- Reversible encryption for secrets the server must use later (webhook signing secrets, TOTP seeds) ----
// AES-256-GCM with a key derived from APP_SECRET. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
function encryptionKey(): Buffer {
  return createHash("sha256").update(`cairn:enc:v1:${env.secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function hmacHex(key: string, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}