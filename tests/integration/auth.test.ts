import { describe, expect, it } from "vitest";
import { Client, PASSWORD, adminClient, registerUser, uniqueEmail } from "./helpers";

describe("registration, login and logout", () => {
  it("registers, sets a secure session cookie, and returns the user", async () => {
    const client = new Client();
    const email = uniqueEmail("reg");
    const res = await client.post("/api/v1/auth/register", { email, password: PASSWORD, displayName: "Reg" });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user).not.toHaveProperty("passwordHash");
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("cairn_session="))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const me = await client.get("/api/v1/auth/me");
    expect(me.body.user.email).toBe(email);
    expect(me.body.user.role).toBe("user");
  });

  it("normalizes email case and rejects duplicates", async () => {
    const email = uniqueEmail("dupe");
    const a = new Client();
    expect((await a.post("/api/v1/auth/register", { email, password: PASSWORD })).status).toBe(201);
    const b = new Client();
    const dup = await b.post("/api/v1/auth/register", { email: email.toUpperCase(), password: PASSWORD });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("conflict");
  });

  it("enforces the password policy with a field-level error", async () => {
    const c = new Client();
    for (const password of ["short", "password123", "aaaaaaaaaaaa"]) {
      const res = await c.post("/api/v1/auth/register", { email: uniqueEmail("weak"), password });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_error");
      expect(res.body.error.details[0].path).toBe("password");
    }
  });

  it("logs in with correct credentials and rejects wrong ones without revealing which part failed", async () => {
    const { email } = await registerUser("login");
    const c = new Client();
    const bad = await c.post("/api/v1/auth/login", { email, password: "wrong wrong wrong" });
    const unknown = await c.post("/api/v1/auth/login", { email: uniqueEmail("ghost"), password: "wrong wrong wrong" });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
    const ok = await c.post("/api/v1/auth/login", { email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect((await c.get("/api/v1/auth/me")).body.user.email).toBe(email);
  });

  it("logout invalidates the session server-side", async () => {
    const { client } = await registerUser("logout");
    const token = client.cookies.get("cairn_session")!;
    expect((await client.post("/api/v1/auth/logout")).status).toBe(200);
    expect((await client.get("/api/v1/auth/me")).body.user).toBeNull();
    // Replaying the old cookie must not work: the session row is gone.
    const replay = new Client();
    replay.cookies.set("cairn_session", token);
    expect((await replay.get("/api/v1/auth/me")).body.user).toBeNull();
  });

  it("locks an account after repeated failures", async () => {
    const { email } = await registerUser("lock");
    const c = new Client();
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await c.post("/api/v1/auth/login", { email, password: "nope nope nope nope" })).status;
    expect(last).toBe(429);
    // Even the right password is refused while locked out.
    const res = await c.post("/api/v1/auth/login", { email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("changes password, signs other sessions out, and old password stops working", async () => {
    const { client, email } = await registerUser("pw");
    const other = new Client();
    await other.post("/api/v1/auth/login", { email, password: PASSWORD });
    expect((await other.get("/api/v1/auth/me")).body.user).not.toBeNull();

    const wrong = await client.post("/api/v1/account/password", { currentPassword: "not my password", newPassword: "another good passphrase" });
    expect(wrong.status).toBe(401);
    const ok = await client.post("/api/v1/account/password", { currentPassword: PASSWORD, newPassword: "another good passphrase" });
    expect(ok.status).toBe(200);
    expect((await client.get("/api/v1/auth/me")).body.user).not.toBeNull();
    expect((await other.get("/api/v1/auth/me")).body.user).toBeNull();
    expect((await new Client().post("/api/v1/auth/login", { email, password: PASSWORD })).status).toBe(401);
    expect((await new Client().post("/api/v1/auth/login", { email, password: "another good passphrase" })).status).toBe(200);
  });

  it("lists and revokes sessions", async () => {
    const { client, email } = await registerUser("sess");
    const second = new Client();
    await second.post("/api/v1/auth/login", { email, password: PASSWORD });
    const list = await client.get("/api/v1/account/sessions");
    expect(list.body.items).toHaveLength(2);
    const other = list.body.items.find((s: any) => !s.current);
    expect((await client.del(`/api/v1/account/sessions/${other.id}`)).status).toBe(200);
    expect((await second.get("/api/v1/auth/me")).body.user).toBeNull();
    expect((await client.del(`/api/v1/account/sessions/${other.id}`)).status).toBe(404);
  });

  it("deletes an account with all of its files, shares and keys", async () => {
    const { client, email } = await registerUser("delete");
    const { uploadFile, randomData } = await import("./helpers");
    const up = await uploadFile(client, { data: randomData(2048), name: "gone.bin", share: true });
    const token = up.file.share.token;
    expect((await new Client().get(`/dl/${token}`)).status).toBe(200);
    const bad = await client.post("/api/v1/account/delete", { password: "wrong wrong wrong", confirm: "DELETE" });
    expect(bad.status).toBe(401);
    const unconfirmed = await client.post("/api/v1/account/delete", { password: PASSWORD, confirm: "nope" });
    expect(unconfirmed.status).toBe(422);
    expect((await client.post("/api/v1/account/delete", { password: PASSWORD, confirm: "DELETE" })).status).toBe(200);
    expect((await new Client().get(`/dl/${token}`)).status).toBe(404);
    expect((await new Client().post("/api/v1/auth/login", { email, password: PASSWORD })).status).toBe(401);
  });

  it("refuses to delete the only administrator", async () => {
    const admin = await adminClient();
    const res = await admin.post("/api/v1/account/delete", { password: "admin passphrase for integration tests", confirm: "DELETE" });
    expect(res.status).toBe(409);
  });

  it("never creates guest sessions: visitors can't upload and registering claims nothing", async () => {
    const { uploadFile, randomData } = await import("./helpers");
    const browser = new Client("visitor");
    const up = await uploadFile(browser, { data: randomData(1500), name: "as-visitor.bin" });
    expect(up.init.status).toBe(401);
    expect(browser.cookies.size).toBe(0);
    const reg = await browser.post("/api/v1/auth/register", { email: uniqueEmail("nogst"), password: PASSWORD });
    expect(reg.status).toBe(201);
    expect(reg.body.claimedFiles).toBeUndefined();
    expect((await browser.get("/api/v1/files")).body.files).toEqual([]);
  });
});
