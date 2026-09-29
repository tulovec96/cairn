import { describe, expect, it } from "vitest";
import { Client, adminClient, randomData, registerUser, uploadFile } from "./helpers";

describe("access control (IDOR)", () => {
  it("never lets one account read or change another account's data", async () => {
    const { client: alice } = await registerUser("alice");
    const { client: bob } = await registerUser("bob");
    const folder = (await alice.post("/api/v1/folders", { name: "Private" })).body.folder;
    const up = await uploadFile(alice, { data: randomData(500), name: "alice.bin", folderId: folder.id, share: false, expiresAt: null });
    const share = (await alice.post("/api/v1/shares", { fileId: up.file.id })).body.share;
    const key = (await alice.post("/api/v1/keys", { name: "alice", scopes: ["files:read"] })).body.item;

    const probes: Array<[string, Promise<{ status: number }>]> = [
      ["file details", bob.get(`/api/v1/files/${up.file.id}`)],
      ["file download", bob.get(`/api/v1/files/${up.file.id}/download`)],
      ["file preview", bob.get(`/api/v1/files/${up.file.id}/preview`)],
      ["file thumbnail", bob.get(`/api/v1/files/${up.file.id}/thumbnail`)],
      ["file rename", bob.patch(`/api/v1/files/${up.file.id}`, { name: "pwned.bin" })],
      ["file delete", bob.del(`/api/v1/files/${up.file.id}`)],
      ["file restore", bob.post(`/api/v1/files/${up.file.id}/restore`)],
      ["folder details", bob.get(`/api/v1/folders/${folder.id}`)],
      ["folder rename", bob.patch(`/api/v1/folders/${folder.id}`, { name: "pwned" })],
      ["folder delete", bob.del(`/api/v1/folders/${folder.id}`)],
      ["share update", bob.patch(`/api/v1/shares/${share.id}`, { revoked: true })],
      ["share delete", bob.del(`/api/v1/shares/${share.id}`)],
      ["api key revoke", bob.del(`/api/v1/keys/${key.id}`)],
      ["share for foreign file", bob.post("/api/v1/shares", { fileId: up.file.id })],
      ["upload into foreign folder", bob.post("/api/v1/uploads", { fileName: "x.bin", size: 10, folderId: folder.id })],
      ["move into foreign folder", (async () => { const mine = await uploadFile(bob, { data: randomData(20), share: false, expiresAt: null }); return bob.patch(`/api/v1/files/${mine.file.id}`, { folderId: folder.id }); })()],
    ];
    for (const [label, p] of probes) expect((await p).status, label).toBe(404);

    // …and nothing was modified.
    const still = await alice.get(`/api/v1/files/${up.file.id}`);
    expect(still.body.file.name).toBe("alice.bin");
    expect((await new Client().get(`/dl/${share.token}`)).status).toBe(200);
    expect((await alice.get("/api/v1/folders")).body.folders).toHaveLength(1);
    expect((await bob.get("/api/v1/files")).body.files.every((f: any) => f.name !== "alice.bin")).toBe(true);
  });

  it("isolates accounts from each other and gives visitors nothing", async () => {
    const { client: g1 } = await registerUser("iso1");
    const { client: g2 } = await registerUser("iso2");
    const a = await uploadFile(g1, { data: randomData(100), name: "g1.bin", share: false });
    await uploadFile(g2, { data: randomData(100), name: "g2.bin", share: false });
    expect((await g2.get(`/api/v1/files/${a.file.id}`)).status).toBe(404);
    expect((await g2.del(`/api/v1/files/${a.file.id}`)).status).toBe(404);
    expect((await g2.patch(`/api/v1/files/${a.file.id}`, { name: "stolen.bin" })).status).toBe(404);
    expect((await g2.get(`/api/v1/files/${a.file.id}/download`)).status).toBe(404);
    expect((await g2.get("/api/v1/files")).body.files.map((f: any) => f.name)).toEqual(["g2.bin"]);
    expect((await new Client().get(`/api/v1/files/${a.file.id}`)).status).toBe(401);
  });

  it("requires authentication and the admin role where appropriate", async () => {
    const anon = new Client();
    const { client: user } = await registerUser("plain");
    for (const path of ["/api/v1/files", "/api/v1/folders", "/api/v1/trash", "/api/v1/shares", "/api/v1/dashboard", "/api/v1/notifications", "/api/v1/keys"]) {
      expect((await anon.get(path)).status, path).toBe(401);
    }
    const adminPaths = ["/api/v1/admin/overview", "/api/v1/admin/users", "/api/v1/admin/files", "/api/v1/admin/reports", "/api/v1/admin/settings", "/api/v1/admin/audit", "/api/v1/admin/storage"];
    for (const path of adminPaths) {
      expect((await anon.get(path)).status, `${path} anon`).toBe(401);
      expect((await user.get(path)).status, `${path} user`).toBe(403);
    }
    expect((await user.put("/api/v1/admin/settings", { webhooks: { maxAttempts: 9 } })).status).toBe(403);
    expect((await user.post("/api/v1/admin/jobs/retry")).status).toBe(403);
    // Pages are gated server-side too: a normal user gets a 404 for /admin, an anonymous visitor is sent to sign in.
    expect((await user.get("/admin")).status).toBe(404);
    const redirect = await anon.get("/dashboard");
    expect([302, 303, 307, 308]).toContain(redirect.status);
    expect(redirect.headers.get("location")).toContain("/login");
  });
});

describe("CSRF and request origin", () => {
  it("rejects cookie-authenticated state changes that come from another origin", async () => {
    const { client } = await registerUser("csrf");
    const evil = await client.post("/api/v1/folders", { name: "csrf" }, { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe("csrf_rejected");
    const crossSite = await client.fetch("/api/v1/folders", { method: "POST", json: { name: "csrf" }, origin: null, headers: { "sec-fetch-site": "cross-site" } });
    expect(crossSite.status).toBe(403);
    expect((await client.post("/api/v1/folders", { name: "legit" })).status).toBe(201);
    // Login and logout can't be forged cross-site either.
    expect((await client.post("/api/v1/auth/logout", {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await client.get("/api/v1/auth/me")).body.user).not.toBeNull();
    // Requests without cookies (scripts, curl) aren't subject to it, and Bearer keys never were.
    const key = (await client.post("/api/v1/keys", { name: "script", scopes: ["files:upload"] })).body.key;
    const script = new Client();
    script.bearer = key;
    expect((await script.post("/api/v1/uploads", { fileName: "s.bin", size: 5 }, { origin: null })).status).toBe(201);
    // ...but with no credentials at all there is nothing to act as.
    expect((await new Client().post("/api/v1/uploads", { fileName: "s.bin", size: 5 }, { origin: null })).status).toBe(401);
  });
});

describe("safe file delivery", () => {
  it("never serves uploaded HTML as HTML: downloads are attachments, previews are plain text", async () => {
    const { client } = await registerUser("html");
    const html = Buffer.from('<!doctype html><script>fetch("/api/v1/keys",{method:"POST"})</script><h1>hi</h1>');
    const up = await uploadFile(client, { data: html, name: "evil.html", share: true, expiresAt: null });
    const token = up.file.share.token;

    const dl = await new Client().get(`/dl/${token}`);
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(dl.headers.get("content-type")).toBe("application/octet-stream");
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(dl.headers.get("content-security-policy")).toContain("sandbox");

    for (const url of [`/dl/${token}?mode=preview`, `/api/v1/files/${up.file.id}/preview`]) {
      const res = await client.get(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toContain("sandbox");
    }
  });

  it("sanitizes SVG previews and serves them sandboxed", async () => {
    const { client } = await registerUser("svg");
    const svg = Buffer.from(
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)" width="20" height="20">` +
        `<script>alert(document.cookie)</script><foreignObject><iframe src="https://evil.example"/></foreignObject>` +
        `<a xlink:href="javascript:alert(2)"><rect width="10" height="10" fill="red" onclick="alert(3)"/></a><image href="https://evil.example/track.png"/>` +
        `<style>@import url(https://evil.example/x.css); rect{fill:url(https://evil.example/f)}</style><circle cx="5" cy="5" r="3" fill="blue"/></svg>`,
    );
    const up = await uploadFile(client, { data: svg, name: "drawing.svg", share: false, expiresAt: null });
    const res = await client.get(`/api/v1/files/${up.file.id}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\/svg\+xml/);
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'.*sandbox/);
    const out = res.text.toLowerCase();
    for (const bad of ["<script", "onload", "onclick", "javascript:", "<foreignobject", "<iframe", "evil.example", "<!doctype", "<!entity", "@import"]) {
      expect(out, `sanitized SVG must not contain ${bad}`).not.toContain(bad);
    }
    expect(out).toContain("<circle"); // harmless content survives
    // The raw file is still only ever delivered as a download.
    const raw = await client.get(`/api/v1/files/${up.file.id}/download`);
    expect(raw.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(raw.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("neutralizes header injection through file names", async () => {
    const { client } = await registerUser("headers");
    const up = await uploadFile(client, { data: randomData(50), name: 'a"b\r\nSet-Cookie: pwned=1; x.txt', share: true, expiresAt: null });
    const dl = await new Client().get(`/dl/${up.file.share.token}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("set-cookie")).toBeNull();
    const cd = dl.headers.get("content-disposition")!;
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd.split(";")[1]).not.toContain('"b"');
  });

  it("only previews types that are safe to show", async () => {
    const { client } = await registerUser("preview");
    const exe = await uploadFile(client, { data: Buffer.concat([Buffer.from("MZ"), randomData(200)]), name: "program.exe", share: false, expiresAt: null });
    const res = await client.get(`/api/v1/files/${exe.file.id}/preview`);
    expect(res.status).toBe(415);
    expect(exe.file.previewKind).toBeNull();
  });

  it("sends security headers on pages and API responses", async () => {
    const page = await new Client().get("/");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("permissions-policy")).toContain("camera=()");
    const csp = page.headers.get("content-security-policy")!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'self'");
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(page.text).toContain(`nonce="${nonce}"`);
    const api = await new Client().get("/api/v1/health");
    expect(api.headers.get("x-content-type-options")).toBe("nosniff");
    expect(api.headers.get("cache-control")).toBe("no-store");
    expect(api.headers.get("x-powered-by")).toBeNull();
  });
});

describe("error hygiene and identifiers", () => {
  it("never leaks internals in error responses", async () => {
    const { client } = await registerUser("errors");
    const cases = [
      await client.get("/api/v1/files/not-an-id!!"),
      await client.get("/api/v1/files/fil_doesnotexist0000"),
      await client.post("/api/v1/folders", { name: 5 }),
      await client.fetch("/api/v1/folders", { method: "POST", body: "{{{", headers: { "content-type": "application/json" } }),
      await client.get("/api/v1/uploads/" + "u".repeat(50)),
    ];
    for (const res of cases) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(Object.keys(res.body.error).sort()).toEqual(expect.arrayContaining(["code", "message"]));
      expect(res.text).not.toMatch(/prisma|stack|at .*\.(ts|js):\d+|SQLITE|node_modules/i);
    }
  });

  it("uses opaque, unpredictable public identifiers", async () => {
    const { client } = await registerUser("ids");
    const ids: string[] = [];
    const tokens: string[] = [];
    for (let i = 0; i < 6; i++) {
      const up = await uploadFile(client, { data: randomData(30), share: true, expiresAt: null });
      ids.push(up.file.id);
      tokens.push(up.file.share.token);
    }
    for (const id of ids) expect(id).toMatch(/^fil_[0-9A-Za-z]{16}$/);
    for (const t of tokens) expect(t).toMatch(/^[0-9A-Za-z]{24}$/);
    expect(new Set(ids).size).toBe(6);
    expect(new Set(tokens).size).toBe(6);
    // No shared prefix beyond the type marker: consecutive ids are not sequential.
    expect(new Set(ids.map((i) => i.slice(4, 8))).size).toBeGreaterThan(3);
    expect(new Set(tokens.map((t) => t.slice(0, 3))).size).toBeGreaterThan(3);
  });
});

describe("sessions and cookies", () => {
  it("issues unpredictable session identifiers and stores only their hashes", async () => {
    const { client, id } = await registerUser("cookie");
    const token = client.cookies.get("cairn_session")!;
    expect(token.length).toBeGreaterThanOrEqual(43);
    const row = await (await import("@/server/db")).db.session.findFirst({ where: { userId: id } });
    expect(row!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row!.tokenHash).not.toBe(token);
    const other = await registerUser("cookie2");
    expect(other.client.cookies.get("cairn_session")).not.toBe(token);
  });

  it("suspended accounts lose access immediately", async () => {
    const admin = await adminClient();
    const { client, id, email } = await registerUser("suspend");
    expect((await client.get("/api/v1/files")).status).toBe(200);
    expect((await admin.patch(`/api/v1/admin/users/${id}`, { status: "suspended", suspendedReason: "test" })).status).toBe(200);
    // Suspension deletes the account's sessions, so the old cookie stops working at once.
    expect((await client.get("/api/v1/files")).status).toBe(401);
    const login = await new Client().post("/api/v1/auth/login", { email, password: "a perfectly good passphrase" });
    expect(login.status).toBe(403);
    await admin.patch(`/api/v1/admin/users/${id}`, { status: "active" });
    expect((await new Client().post("/api/v1/auth/login", { email, password: "a perfectly good passphrase" })).status).toBe(200);
  });
});
