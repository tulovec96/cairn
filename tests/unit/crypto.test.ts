import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashPassword, hashToken, hmacHex, safeEqual, sha256Hex, verifyPassword } from "@/server/crypto";
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totpCounter, verifyTotp } from "@/server/totp";

describe("hashing", () => {
  it("computes SHA-256 hex", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken("abc")).toBe(sha256Hex("abc"));
  });
  it("computes HMAC-SHA256 hex (RFC 4231 test case 2)", () => {
    expect(hmacHex("Jefe", "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });
  it("compares strings in constant time and handles differing lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", h)).toBe(false);
  });
  it("salts every hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
  });
  it("normalizes Unicode so equivalent passwords match", async () => {
    const h = await hashPassword("café-passphrase");
    expect(await verifyPassword("café-passphrase", h)).toBe(true);
  });
  it("rejects malformed stored hashes without throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
    expect(await verifyPassword("x", "scrypt$a$b$c$d$e")).toBe(false);
  });
});

describe("encryptSecret", () => {
  it("round-trips and uses a fresh nonce", () => {
    const a = encryptSecret("whsec_abc");
    const b = encryptSecret("whsec_abc");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("whsec_abc");
  });
  it("rejects tampered ciphertext", () => {
    const enc = encryptSecret("value");
    const buf = Buffer.from(enc, "base64url");
    buf[buf.length - 1] ^= 1;
    expect(() => decryptSecret(buf.toString("base64url"))).toThrow();
  });
});

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 appendix B uses the ASCII secret "12345678901234567890" with SHA-1.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("produces the reference code at t=%i", (t, code) => {
    expect(hotp(base32Decode(secret), totpCounter(t * 1000))).toBe(code);
    expect(verifyTotp(secret, code, t * 1000)).toBe(totpCounter(t * 1000));
  });
  it("accepts one step of drift and no more", () => {
    const now = 1_700_000_000_000;
    const key = base32Decode(secret);
    const c = totpCounter(now);
    expect(verifyTotp(secret, hotp(key, c - 1), now)).toBe(c - 1);
    expect(verifyTotp(secret, hotp(key, c + 1), now)).toBe(c + 1);
    expect(verifyTotp(secret, hotp(key, c - 2), now)).toBeNull();
    expect(verifyTotp(secret, hotp(key, c + 2), now)).toBeNull();
  });
  it("rejects malformed codes", () => {
    expect(verifyTotp(secret, "abcdef")).toBeNull();
    expect(verifyTotp(secret, "12345")).toBeNull();
    expect(verifyTotp(secret, "")).toBeNull();
  });
  it("tolerates spaces in the entered code", () => {
    const now = 1_700_000_000_000;
    const code = hotp(base32Decode(secret), totpCounter(now));
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(totpCounter(now));
  });
  it("round-trips base32 and generates usable secrets", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(() => base32Decode("!!")).toThrow();
  });
  it("builds an otpauth URI authenticator apps understand", () => {
    const uri = otpauthUri({ secret: "ABC", account: "me@example.com", issuer: "Cairn" });
    expect(uri).toBe("otpauth://totp/Cairn%3Ame%40example.com?secret=ABC&issuer=Cairn&algorithm=SHA1&digits=6&period=30");
  });
});
