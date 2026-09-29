import { beforeAll, describe, expect, it } from "vitest";
import { Client, adminClient, assignPlan, randomData, registerUser, sha256, uploadFile } from "./helpers";

/** Direct DB access for states that would otherwise need waiting (expiry). */
async function db() {
  return (await import("@/server/db")).db;
}

async function shareFor(owner: Client, data = randomData(4096), name = "shared.bin", opts: Record<string, unknown> = {}) {
  const up = await uploadFile(owner, { data, name, share: false, expiresAt: null });
  const res = await owner.post("/api/v1/shares", { fileId: up.file.id, ...opts });
  if (res.status !== 201) throw new Error(`share failed ${res.status} ${res.text}`);
  return { file: up.file, share: res.body.share, data, token: res.body.share.token as string };
}

describe("public links and downloads", () => {
  it("serves the public page metadata and counts full downloads (not HEAD or ranges past the start)", async () => {
    const { client } = await registerUser("share");
    const { token, data, file } = await shareFor(client);
    const visitor = new Client();
    const info = await visitor.get(`/api/v1/public/shares/${token}`);
    expect(info.status).toBe(200);
    expect(info.body.share.file).toMatchObject({ name: "shared.bin", size: data.length, sha256: sha256(data), status: "available" });

    const head = await visitor.fetch(`/dl/${token}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(data.length));
    expect(head.headers.get("accept-ranges")).toBe("bytes");
    expect(head.headers.get("etag")).toBe(`"${sha256(data)}"`);
    expect((await client.get(`/api/v1/files/${file.id}`)).body.file.downloadCount).toBe(0);

    const full = await visitor.get(`/dl/${token}`);
    expect(full.status).toBe(200);
    expect(sha256(full.buffer)).toBe(sha256(data));
    expect(full.headers.get("content-disposition")).toMatch(/^attachment; filename="shared\.bin"; filename\*=UTF-8''shared\.bin$/);
    expect((await client.get(`/api/v1/files/${file.id}`)).body.file.downloadCount).toBe(1);

    await visitor.get(`/dl/${token}`, { headers: { range: "bytes=100-199" } });
    expect((await client.get(`/api/v1/files/${file.id}`)).body.file.downloadCount).toBe(1); // mid-file resume isn't a new download
    await visitor.get(`/dl/${token}`, { headers: { range: "bytes=0-99" } });
    expect((await client.get(`/api/v1/files/${file.id}`)).body.file.downloadCount).toBe(2);
  });

  it("supports HTTP Range requests correctly", async () => {
    const { client } = await registerUser("range");
    const { token, data } = await shareFor(client, randomData(10_000));
    const v = new Client();
    const mid = await v.get(`/dl/${token}`, { headers: { range: "bytes=10-19" } });
    expect(mid.status).toBe(206);
    expect(mid.headers.get("content-range")).toBe("bytes 10-19/10000");
    expect(mid.headers.get("content-length")).toBe("10");
    expect(mid.buffer.equals(data.subarray(10, 20))).toBe(true);

    const suffix = await v.get(`/dl/${token}`, { headers: { range: "bytes=-25" } });
    expect(suffix.status).toBe(206);
    expect(suffix.buffer.equals(data.subarray(9975))).toBe(true);

    const open = await v.get(`/dl/${token}`, { headers: { range: "bytes=9990-" } });
    expect(open.headers.get("content-range")).toBe("bytes 9990-9999/10000");

    const clamped = await v.get(`/dl/${token}`, { headers: { range: "bytes=9990-99999" } });
    expect(clamped.headers.get("content-range")).toBe("bytes 9990-9999/10000");

    const unsat = await v.get(`/dl/${token}`, { headers: { range: "bytes=20000-" } });
    expect(unsat.status).toBe(416);
    expect(unsat.headers.get("content-range")).toBe("bytes */10000");

    // Malformed and multi-range requests are ignored (full body), per RFC 9110.
    for (const range of ["bytes=abc", "bytes=0-5,10-15", "items=1-2"]) {
      const r = await v.get(`/dl/${token}`, { headers: { range } });
      expect(r.status, range).toBe(200);
      expect(r.buffer.length).toBe(10_000);
    }
    // If-Range with a stale validator falls back to the full representation.
    const stale = await v.get(`/dl/${token}`, { headers: { range: "bytes=0-9", "if-range": '"stale"' } });
    expect(stale.status).toBe(200);
    const fresh = await v.get(`/dl/${token}`, { headers: { range: "bytes=0-9", "if-range": `"${sha256(data)}"` } });
    expect(fresh.status).toBe(206);
  });

  it("renders the download page and a friendly page for unknown links", async () => {
    const { client } = await registerUser("page");
    const { token } = await shareFor(client, randomData(300), "page-test.bin");
    const page = await new Client().get(`/d/${token}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain("page-test.bin");
    expect(page.text).toContain("Download");
    const missing = await new Client().get(`/d/${"z".repeat(24)}`);
    expect(missing.text).toContain("doesn&#x27;t exist");
    // Malformed and unknown tokens behave identically: nothing to enumerate.
    expect((await new Client().get("/api/v1/public/shares/short")).status).toBe(404);
    expect((await new Client().get(`/api/v1/public/shares/${"z".repeat(24)}`)).status).toBe(404);
    expect((await new Client().get("/dl/short")).status).toBe(404);
  });
});

describe("password-protected links", () => {
  it("hides everything until the correct password unlocks the link for that browser only", async () => {
    const { client } = await registerUser("pwshare");
    const { token, data, share } = await shareFor(client, randomData(2000), "secret.bin", { password: "open sesame" });
    expect(share.hasPassword).toBe(true);
    const v = new Client();
    const info = await v.get(`/api/v1/public/shares/${token}`);
    expect(info.body.share).toMatchObject({ requiresPassword: true, unlocked: false });
    expect(info.body.share.file).toBeUndefined(); // not even the file name is revealed
    const locked = await v.get(`/dl/${token}`);
    expect(locked.status).toBe(401);
    expect(locked.body.error.code).toBe("password_required");
    const page = await v.get(`/d/${token}`);
    expect(page.text).not.toContain("secret.bin");

    const wrong = await v.post(`/api/v1/public/shares/${token}/unlock`, { password: "nope nope" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("invalid_password");
    expect((await v.get(`/dl/${token}`)).status).toBe(401);

    const ok = await v.post(`/api/v1/public/shares/${token}/unlock`, { password: "open sesame" });
    expect(ok.status).toBe(200);
    const unlocked = await v.get(`/dl/${token}`);
    expect(unlocked.status).toBe(200);
    expect(sha256(unlocked.buffer)).toBe(sha256(data));
    expect((await v.get(`/api/v1/public/shares/${token}`)).body.share.file.name).toBe("secret.bin");

    // A different browser, or a cookie forged for another link, doesn't get in.
    expect((await new Client().get(`/dl/${token}`)).status).toBe(401);
    const other = await shareFor(client, randomData(100), "other.bin", { password: "another one" });
    const forged = new Client();
    const name = [...v.cookies.keys()].find((k) => k.startsWith("cairn_su_"))!;
    forged.cookies.set(`cairn_su_${other.token.slice(0, 10)}`, v.cookies.get(name)!);
    expect((await forged.get(`/dl/${other.token}`)).status).toBe(401);
  });

  it("changing or removing the password takes effect immediately", async () => {
    const { client } = await registerUser("pwchange");
    const { token, share } = await shareFor(client, randomData(500), "pw.bin", { password: "first password" });
    const v = new Client();
    await v.post(`/api/v1/public/shares/${token}/unlock`, { password: "first password" });
    expect((await v.get(`/dl/${token}`)).status).toBe(200);
    await client.patch(`/api/v1/shares/${share.id}`, { password: "second password" });
    expect((await v.get(`/dl/${token}`)).status).toBe(401); // the old unlock cookie no longer matches
    expect((await v.post(`/api/v1/public/shares/${token}/unlock`, { password: "first password" })).status).toBe(401);
    expect((await v.post(`/api/v1/public/shares/${token}/unlock`, { password: "second password" })).status).toBe(200);
    await client.patch(`/api/v1/shares/${share.id}`, { password: null });
    expect((await new Client().get(`/dl/${token}`)).status).toBe(200);
  });

  it("rate limits password guessing and never stores the password in plain text", async () => {
    const { client } = await registerUser("pwrate");
    const { token, share } = await shareFor(client, randomData(100), "rate.bin", { password: "correct horse" });
    const attacker = new Client();
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await attacker.post(`/api/v1/public/shares/${token}/unlock`, { password: `guess ${i}` })).status);
    expect(codes.slice(0, 8).every((c) => c === 401)).toBe(true);
    expect(codes.slice(8)).toEqual([429, 429]);
    // Even the right password is refused during the lockout window.
    const right = await attacker.post(`/api/v1/public/shares/${token}/unlock`, { password: "correct horse" });
    expect(right.status).toBe(429);
    expect(right.headers.get("retry-after")).toBeTruthy();

    const row = await (await db()).shareLink.findUnique({ where: { id: share.id } });
    expect(row!.passwordHash).toMatch(/^scrypt\$/);
    expect(row!.passwordHash).not.toContain("correct horse");
  });
});

describe("expiring, limited and revoked links", () => {
  it("stops serving when the link or the file has expired", async () => {
    const { client } = await registerUser("expire");
    const { token, share, file } = await shareFor(client, randomData(300), "exp.bin");
    const d = await db();
    await d.shareLink.update({ where: { id: share.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const gone = await new Client().get(`/dl/${token}`);
    expect(gone.status).toBe(410);
    expect((await new Client().get(`/api/v1/public/shares/${token}`)).status).toBe(410);
    expect((await client.get("/api/v1/shares")).body.items.find((s: any) => s.id === share.id).state).toBe("expired");

    const second = await shareFor(client, randomData(300), "exp2.bin");
    await d.file.update({ where: { id: second.file.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await new Client().get(`/dl/${second.token}`)).status).toBe(410);
    void file;
  });

  it("enforces download limits atomically", async () => {
    const { client, id } = await registerUser("limit");
    await assignPlan(await adminClient(), id, "pro"); // download limits are a plan feature
    const { token, share } = await shareFor(client, randomData(400), "limited.bin", { maxDownloads: 2 });
    const v = new Client();
    expect((await v.get(`/dl/${token}`)).status).toBe(200);
    expect((await v.get(`/dl/${token}`)).status).toBe(200);
    const third = await v.get(`/dl/${token}`);
    expect(third.status).toBe(410);
    expect(third.body.error.message).toMatch(/limit/i);
    expect((await client.get("/api/v1/shares")).body.items.find((s: any) => s.id === share.id)).toMatchObject({ downloadCount: 2, state: "exhausted" });

    // Concurrent downloads can't sneak past the limit.
    const race = await shareFor(client, randomData(400), "race.bin", { maxDownloads: 3 });
    const results = await Promise.all(Array.from({ length: 8 }, () => new Client().get(`/dl/${race.token}`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
  });

  it("revokes and deletes links, and disables them when the file is trashed", async () => {
    const { client } = await registerUser("revoke");
    const { token, share, file } = await shareFor(client, randomData(300), "rev.bin");
    expect((await new Client().get(`/dl/${token}`)).status).toBe(200);
    const revoked = await client.patch(`/api/v1/shares/${share.id}`, { revoked: true });
    expect(revoked.body.share.state).toBe("revoked");
    expect((await new Client().get(`/dl/${token}`)).status).toBe(410);
    expect((await client.patch(`/api/v1/shares/${share.id}`, { maxDownloads: 5 })).status).toBe(409);
    expect((await client.del(`/api/v1/shares/${share.id}`)).status).toBe(204);
    expect((await new Client().get(`/dl/${token}`)).status).toBe(404);

    const again = await shareFor(client, randomData(300), "trashed.bin");
    await client.del(`/api/v1/files/${again.file.id}`);
    expect((await new Client().get(`/dl/${again.token}`)).status).toBe(410);
    const trash = (await client.get("/api/v1/trash")).body.items[0];
    await client.post(`/api/v1/trash/${trash.id}`);
    expect((await new Client().get(`/dl/${again.token}`)).status).toBe(200); // restoring revives the link
    void file;
  });

  it("validates share options and ownership", async () => {
    const { client } = await registerUser("shareopts");
    const { client: other } = await registerUser("shareother");
    const up = await uploadFile(client, { data: randomData(100), share: false, expiresAt: null });
    expect((await client.post("/api/v1/shares", {})).status).toBe(422);
    expect((await client.post("/api/v1/shares", { fileId: up.file.id, folderId: "fld_abcdefghijklmnop" })).status).toBe(422);
    expect((await client.post("/api/v1/shares", { fileId: up.file.id, password: "abc" })).status).toBe(422);
    expect((await client.post("/api/v1/shares", { fileId: up.file.id, expiresAt: new Date(Date.now() - 5000).toISOString() })).status).toBe(422);
    expect((await client.post("/api/v1/shares", { fileId: up.file.id, maxDownloads: 0 })).status).toBe(422);
    expect((await other.post("/api/v1/shares", { fileId: up.file.id })).status).toBe(404);
    const mine = await client.post("/api/v1/shares", { fileId: up.file.id });
    expect((await other.patch(`/api/v1/shares/${mine.body.share.id}`, { revoked: true })).status).toBe(404);
    expect((await other.del(`/api/v1/shares/${mine.body.share.id}`)).status).toBe(404);
    expect((await other.get("/api/v1/shares")).body.items).toEqual([]);
  });

  it("issues cryptographically random tokens and only lets owners manage their links", async () => {
    const { client: owner } = await registerUser("tokens");
    const up = await uploadFile(owner, { data: randomData(200), share: true });
    const tokens = new Set<string>([up.file.share.token]);
    for (let i = 0; i < 5; i++) {
      const s = await owner.post("/api/v1/shares", { fileId: up.file.id, password: "owner-pass" });
      expect(s.body.share.token).toMatch(/^[0-9A-Za-z]{24}$/);
      tokens.add(s.body.share.token);
    }
    expect(tokens.size).toBe(6);
    expect((await owner.get("/api/v1/shares")).body.items).toHaveLength(6);
    const { client: other } = await registerUser("tokens-other");
    expect((await other.get("/api/v1/shares")).body.items).toHaveLength(0);
    expect((await other.post("/api/v1/shares", { fileId: up.file.id })).status).toBe(404);
    expect((await new Client().post("/api/v1/shares", { fileId: up.file.id })).status).toBe(401);
  });
});

describe("folder shares", () => {
  let owner: Client;
  let folderId: string;
  let token: string;
  const inside = randomData(2500);
  const nested = randomData(1800);
  beforeAll(async () => {
    ({ client: owner } = await registerUser("foldershare"));
    const folder = (await owner.post("/api/v1/folders", { name: "Shared Folder" })).body.folder;
    folderId = folder.id;
    const sub = (await owner.post("/api/v1/folders", { name: "Nested", parentId: folderId })).body.folder;
    await uploadFile(owner, { data: inside, name: "top.bin", folderId, share: false, expiresAt: null });
    await uploadFile(owner, { data: nested, name: "deep.bin", folderId: sub.id, share: false, expiresAt: null });
    token = (await owner.post("/api/v1/shares", { folderId })).body.share.token;
  });

  it("lists contents on the public page and serves individual files", async () => {
    const info = await new Client().get(`/api/v1/public/shares/${token}`);
    expect(info.body.share.kind).toBe("folder");
    expect(info.body.share.folder).toMatchObject({ name: "Shared Folder", fileCount: 2, totalSize: inside.length + nested.length });
    const items = info.body.share.folder.items;
    expect(items.map((i: any) => i.path).sort()).toEqual(["Nested/deep.bin", "top.bin"]);
    const one = await new Client().get(`/dl/${token}?f=${items.find((i: any) => i.path === "Nested/deep.bin").id}`);
    expect(one.status).toBe(200);
    expect(sha256(one.buffer)).toBe(sha256(nested));
  });

  it("refuses files outside the shared folder", async () => {
    const outside = await uploadFile(owner, { data: randomData(50), name: "private.bin", share: false, expiresAt: null });
    const res = await new Client().get(`/dl/${token}?f=${outside.file.id}`);
    expect(res.status).toBe(404);
    const {client: stranger} = await registerUser("stranger");
    const foreign = await uploadFile(stranger, { data: randomData(50), share: false, expiresAt: null });
    expect((await new Client().get(`/dl/${token}?f=${foreign.file.id}`)).status).toBe(404);
  });

  it("streams a ZIP of the whole folder", async () => {
    const zip = await new Client().get(`/dl/${token}?mode=zip`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect(zip.headers.get("content-disposition")).toContain("Shared Folder.zip");
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(zip.buffer));
    expect(Object.keys(entries).sort()).toEqual(["Shared Folder/Nested/deep.bin", "Shared Folder/top.bin"]);
    expect(sha256(Buffer.from(entries["Shared Folder/top.bin"]))).toBe(sha256(inside));
  });
});

describe("abuse reports", () => {
  it("accepts reports from the public page, de-duplicates and rate limits them", async () => {
    const { client } = await registerUser("reported");
    const { token } = await shareFor(client, randomData(100), "reported.bin");
    const reporter = new Client();
    const first = await reporter.post(`/api/v1/public/shares/${token}/report`, { category: "malware", description: "This looks like malware to me." });
    expect(first.status).toBe(201);
    const dup = await reporter.post(`/api/v1/public/shares/${token}/report`, { category: "spam", description: "Same file, second report." });
    expect(dup.body.report.id).toBe(first.body.report.id);
    expect((await reporter.post(`/api/v1/public/shares/${token}/report`, { category: "nonsense", description: "bad category" })).status).toBe(422);
    expect((await reporter.post(`/api/v1/public/shares/${token}/report`, { category: "spam", description: "x" })).status).toBe(422);
    expect((await reporter.post(`/api/v1/public/shares/${"y".repeat(24)}/report`, { category: "spam", description: "unknown link here" })).status).toBe(404);

    const admin = await adminClient();
    const pending = await admin.get("/api/v1/admin/reports?status=pending");
    expect(pending.body.items.some((r: any) => r.id === first.body.report.id && r.fileName === "reported.bin")).toBe(true);
  });
});
