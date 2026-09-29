import { describe, expect, it } from "vitest";
import { hotp, totpCounter, base32Decode } from "@/server/totp";
import { Client, PASSWORD, adminClient, randomData, registerUser, uniqueEmail } from "./helpers";

const db = async () => (await import("@/server/db")).db;
const tokenFrom = (body: string, path: string) => new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(body)![1];
const code = (secret: string, offset = 0) => hotp(base32Decode(secret), totpCounter() + offset);

describe("password reset and email verification", () => {
  it("emails a one-time reset link, never reveals whether an address exists, and signs everything out", async () => {
    const { client, email } = await registerUser("reset");
    const other = new Client();
    expect((await other.post("/api/v1/auth/login", { email, password: PASSWORD })).status).toBe(200);

    const unknown = await new Client().post("/api/v1/auth/forgot", { email: "nobody-here@itest.test" });
    const known = await new Client().post("/api/v1/auth/forgot", { email });
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);

    const mail = await (await db()).emailMessage.findFirst({ where: { toEmail: email, template: "password_reset" }, orderBy: { createdAt: "desc" } });
    expect(mail).toBeTruthy();
    expect(mail!.status).toBe("skipped"); // no provider configured: recorded, honestly not sent
    const token = tokenFrom(mail!.body, "/reset-password");
    expect((await unknown.headers.get("x-request-id")) && (await new Client().post("/api/v1/auth/forgot", { email: "nobody-here@itest.test" })).status).toBe(200);

    expect((await new Client().post("/api/v1/auth/reset", { token, password: "short" })).status).toBe(422);
    const ok = await new Client().post("/api/v1/auth/reset", { token, password: "a brand new passphrase" });
    expect(ok.status).toBe(200);
    // Single use.
    expect((await new Client().post("/api/v1/auth/reset", { token, password: "another new passphrase" })).status).toBe(400);
    // All sessions are gone, and only the new password works.
    expect((await client.get("/api/v1/files")).status).toBe(401);
    expect((await other.get("/api/v1/files")).status).toBe(401);
    expect((await new Client().post("/api/v1/auth/login", { email, password: PASSWORD })).status).toBe(401);
    expect((await new Client().post("/api/v1/auth/login", { email, password: "a brand new passphrase" })).status).toBe(200);
  });

  it("rejects garbage and expired reset tokens", async () => {
    expect((await new Client().post("/api/v1/auth/reset", { token: "x".repeat(43), password: "a brand new passphrase" })).status).toBe(400);
    const { email, id } = await registerUser("expired");
    await new Client().post("/api/v1/auth/forgot", { email });
    const d = await db();
    await d.authToken.updateMany({ where: { userId: id, purpose: "password_reset" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const mail = await d.emailMessage.findFirst({ where: { toEmail: email, template: "password_reset" } });
    expect((await new Client().post("/api/v1/auth/reset", { token: tokenFrom(mail!.body, "/reset-password"), password: "a brand new passphrase" })).status).toBe(400);
  });

  it("verifies an email address with the emailed link", async () => {
    const { client, email } = await registerUser("verify");
    expect((await client.get("/api/v1/auth/me")).body.user.emailVerified).toBe(false);
    const mail = await (await db()).emailMessage.findFirst({ where: { toEmail: email, template: "verify_email" } });
    const token = tokenFrom(mail!.body, "/verify-email");
    expect((await new Client().post("/api/v1/auth/verify-email", { token })).status).toBe(200);
    expect((await client.get("/api/v1/auth/me")).body.user.emailVerified).toBe(true);
    expect((await new Client().post("/api/v1/auth/verify-email", { token })).status).toBe(400);
  });

  it("lets an administrator issue a recovery link for a locked-out user", async () => {
    const admin = await adminClient();
    const { email, id } = await registerUser("locked");
    const { link } = (await admin.post(`/api/v1/admin/users/${id}/recovery-link`)).body;
    const token = /token=([A-Za-z0-9_-]+)/.exec(link)![1];
    expect((await new Client().post("/api/v1/auth/reset", { token, password: "recovered passphrase!" })).status).toBe(200);
    expect((await new Client().post("/api/v1/auth/login", { email, password: "recovered passphrase!" })).status).toBe(200);
  });
});

describe("two-factor authentication", () => {
  it("sets up TOTP, requires a code to sign in, accepts each backup code once, and can be turned off", async () => {
    const { client, email } = await registerUser("twofa");
    const setup = (await client.post("/api/v1/account/2fa")).body;
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.uri).toContain("otpauth://totp/");
    expect(setup.qrSvg).toContain("<svg");
    expect((await client.put("/api/v1/account/2fa", { code: "000000" })).status).toBe(401);
    const enabled = await client.put("/api/v1/account/2fa", { code: code(setup.secret) });
    expect(enabled.status).toBe(200);
    expect(enabled.body.backupCodes).toHaveLength(10);
    expect((await client.get("/api/v1/auth/me")).body.user.twoFactorEnabled).toBe(true);
    const row = await (await db()).user.findFirst({ where: { email } });
    expect(row!.totpSecret).not.toContain(setup.secret); // encrypted at rest
    expect(JSON.stringify(row!.backupCodes)).not.toContain(enabled.body.backupCodes[0]);

    const fresh = new Client();
    const noCode = await fresh.post("/api/v1/auth/login", { email, password: PASSWORD });
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.code).toBe("two_factor_required");
    expect(fresh.cookies.size).toBe(0);
    const wrong = await fresh.post("/api/v1/auth/login", { email, password: PASSWORD, code: "123456" });
    expect(wrong.body.error.code).toBe("invalid_code");
    expect((await new Client().post("/api/v1/auth/login", { email, password: "wrong wrong wrong", code: code(setup.secret) })).status).toBe(401);

    // A time-based code works, but can't be replayed.
    const c1 = new Client();
    const next = code(setup.secret, 1);
    expect((await c1.post("/api/v1/auth/login", { email, password: PASSWORD, code: next })).status).toBe(200);
    expect((await new Client().post("/api/v1/auth/login", { email, password: PASSWORD, code: next })).status).toBe(401);

    // Backup codes are one-time.
    const backup = enabled.body.backupCodes[0] as string;
    expect((await new Client().post("/api/v1/auth/login", { email, password: PASSWORD, code: backup })).status).toBe(200);
    expect((await new Client().post("/api/v1/auth/login", { email, password: PASSWORD, code: backup })).status).toBe(401);
    expect((await client.get("/api/v1/account/history")).body.backupCodesRemaining).toBe(9);

    // Turning it off needs the password and a valid second factor.
    expect((await client.fetch("/api/v1/account/2fa", { method: "DELETE", json: { password: PASSWORD } })).body.error.code).toBe("two_factor_required");
    const off = await client.fetch("/api/v1/account/2fa", { method: "DELETE", json: { password: PASSWORD, code: enabled.body.backupCodes[1] } });
    expect(off.status).toBe(200);
    expect((await new Client().post("/api/v1/auth/login", { email, password: PASSWORD })).status).toBe(200);
  });

  it("keeps account management out of reach of API keys", async () => {
    const { client } = await registerUser("keyblock");
    const key = (await client.post("/api/v1/keys", { name: "k", scopes: ["files:read", "files:write"] })).body.key;
    const api = new Client();
    api.bearer = key;
    for (const [method, path] of [
      ["POST", "/api/v1/account/2fa"],
      ["GET", "/api/v1/account/sessions"],
      ["POST", "/api/v1/keys"],
      ["POST", "/api/v1/account/password"],
    ] as const) {
      const res = await api.fetch(path, method === "GET" ? { method, origin: null } : { method, json: {}, origin: null });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("profile and preferences", () => {
  it("updates the profile, keeps usernames unique and validates time zones", async () => {
    const { client } = await registerUser("profile");
    const uname = `user_${Date.now().toString(36)}`;
    const res = await client.patch("/api/v1/account/profile", { displayName: "Pat", username: uname, bio: "Hello", timezone: "Europe/Berlin", theme: "dark", prefs: { fileView: "grid" }, privacy: { showProfile: false } });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ displayName: "Pat", username: uname, bio: "Hello", timezone: "Europe/Berlin", theme: "dark" });
    const { client: other } = await registerUser("profile2");
    expect((await other.patch("/api/v1/account/profile", { username: uname })).status).toBe(409);
    expect((await other.patch("/api/v1/account/profile", { username: "admin" })).status).toBe(422);
    expect((await other.patch("/api/v1/account/profile", { username: "no spaces!" })).status).toBe(422);
    expect((await other.patch("/api/v1/account/profile", { timezone: "Mars/Olympus" })).status).toBe(422);
    expect((await other.patch("/api/v1/account/profile", { theme: "neon" })).status).toBe(422);
  });

  it("re-encodes avatars as WebP and rejects non-images", async () => {
    const { client, id } = await registerUser("avatar");
    const { default: sharp } = await import("sharp");
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#22aa66" } }).png().toBuffer();
    const put = await client.fetch("/api/v1/account/avatar", { method: "PUT", body: new Uint8Array(png), headers: { "content-type": "image/png" } });
    expect(put.status).toBe(200);
    expect(put.body.user.avatarUrl).toContain(`/api/v1/users/${id}/avatar`);
    const got = await client.get(put.body.user.avatarUrl);
    expect(got.headers.get("content-type")).toBe("image/webp");
    const meta = await sharp(got.buffer).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect((await new Client().get(put.body.user.avatarUrl)).status).toBe(401);
    const { client: stranger } = await registerUser("avatar-stranger");
    expect((await stranger.get(put.body.user.avatarUrl)).status).toBe(404); // only visible to co-members of an organization
    expect((await client.fetch("/api/v1/account/avatar", { method: "PUT", body: new Uint8Array(randomData(100)) })).status).toBe(422);
    expect((await client.del("/api/v1/account/avatar")).body.user.avatarUrl).toBeNull();
  });

  it("lists sessions and login history, and revokes other sessions", async () => {
    const { client, email } = await registerUser("sessions");
    const second = new Client();
    await second.post("/api/v1/auth/login", { email, password: PASSWORD });
    await new Client().post("/api/v1/auth/login", { email, password: "nope nope nope" });
    const sessions = (await client.get("/api/v1/account/sessions")).body.items;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s: any) => s.current)).toHaveLength(1);
    const history = (await client.get("/api/v1/account/history")).body.items.map((h: any) => h.action);
    expect(history).toEqual(expect.arrayContaining(["auth.login", "auth.login_failed"]));
    expect((await client.del("/api/v1/account/sessions")).body.revoked).toBe(1);
    expect((await second.get("/api/v1/files")).status).toBe(401);
    expect((await client.get("/api/v1/files")).status).toBe(200);
  });

  it("changes the email address (needs the password) and re-requires verification", async () => {
    const { client } = await registerUser("emailchange");
    const next = uniqueEmail("changed");
    expect((await client.post("/api/v1/account/email", { password: "wrong wrong wrong", email: next })).status).toBe(401);
    expect((await client.post("/api/v1/account/email", { password: PASSWORD, email: next })).status).toBe(200);
    const me = (await client.get("/api/v1/auth/me")).body.user;
    expect(me.email).toBe(next);
    expect(me.emailVerified).toBe(false);
  });
});

describe("account deletion", () => {
  it("needs the password, removes everything and its links", async () => {
    const { client, email } = await registerUser("bye");
    const { uploadFile } = await import("./helpers");
    const up = await uploadFile(client, { data: randomData(300), share: true });
    expect((await client.post("/api/v1/account/delete", { password: "wrong wrong wrong", confirm: "DELETE" })).status).toBe(401);
    expect((await client.post("/api/v1/account/delete", { password: PASSWORD, confirm: "nope" })).status).toBe(422);
    expect((await client.post("/api/v1/account/delete", { password: PASSWORD, confirm: "DELETE" })).status).toBe(200);
    expect((await new Client().get(`/dl/${up.file.share.token}`)).status).toBe(404);
    expect((await new Client().post("/api/v1/auth/login", { email, password: PASSWORD })).status).toBe(401);
  });
});
