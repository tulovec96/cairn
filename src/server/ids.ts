import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Cryptographically secure base62 string (rejection sampling, no modulo bias). */
export function randomString(length: number): string {
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (const b of bytes) {
      if (b < 248) {
        out += ALPHABET[b % 62];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

export type IdPrefix =
  | "usr" | "ses" | "fld" | "fil" | "upl" | "chk" | "shr" | "key" | "dwn" | "rpt" | "scn" | "fav" | "trs" | "ntf" | "aud" | "job" | "arc" | "bat"
  | "evt" | "org" | "inv" | "mem" | "tag" | "sch" | "wbh" | "wdl" | "aut" | "aur" | "req" | "ver" | "sub" | "bil" | "tkt" | "msg" | "cmt" | "act"
  | "imp" | "exp" | "bkp" | "inc" | "chg" | "tok" | "eml" | "fmb" | "shv" | "use" | "qrn" | "api" | "stc" | "apu" | "arn" | "rcv" | "pin";

/** Opaque, unpredictable identifier. 16 base62 chars is ~95 bits of entropy. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomString(16)}`;
}

export function newShareToken(): string {
  return randomString(24);
}

export function newSecretToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function newStorageKey(): string {
  const hex = randomBytes(24).toString("hex");
  return `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex.slice(4)}`;
}

const ID_RE = /^[a-z]{3}_[0-9A-Za-z]{16}$/;
export function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

const TOKEN_RE = /^[0-9A-Za-z]{24}$/;
export function isValidShareToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}
