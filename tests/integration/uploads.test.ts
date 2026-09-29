import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, adminClient, putChunk, randomData, registerUser, setSettings, setUserLimits, sha256, uploadFile, waitFor } from "./helpers";

const CHUNK = 256 * 1024; // smallest allowed chunk size, so modest files exercise many chunks

let admin: Client;
beforeAll(async () => {
  admin = await adminClient();
  await setSettings(admin, { uploads: { chunkSizeBytes: CHUNK } });
});
afterAll(async () => {
  await setSettings(admin, { uploads: { chunkSizeBytes: 8 * 1024 * 1024 }, maintenance: { enabled: false }, files: { blockedExtensions: ["scr", "pif", "vbs", "vbe", "wsf", "wsh", "hta", "cpl", "lnk"], allowedExtensions: [] } });
});

describe("resumable uploads", () => {
  it("requires an account: there are no guest uploads", async () => {
    const anon = new Client();
    expect((await anon.post("/api/v1/uploads", { fileName: "a.bin", size: 10 })).status).toBe(401);
    const raw = await anon.fetch("/api/v1/files?name=raw.bin", { method: "POST", body: new Uint8Array(10) });
    expect(raw.status).toBe(401);
    expect(anon.cookies.size).toBe(0); // and nothing was created for the visitor
  });

  it("stores the file privately, verifies it and reports it honestly as not scanned", async () => {
    const { client } = await registerUser("up1");
    const data = randomData(CHUNK * 3 + 1234);
    const up = await uploadFile(client, { data, name: "hello world.bin", share: false });
    expect(up.init.status).toBe(201);
    expect(up.init.body.upload.totalChunks).toBe(4);
    expect(up.upload.status).toBe("complete");
    expect(up.file).toMatchObject({ name: "hello world.bin", size: data.length, sha256: sha256(data), status: "available", scanStatus: "not_scanned", share: null });
    const dl = await client.get(`/api/v1/files/${up.file.id}/download`);
    expect(dl.status).toBe(200);
    expect(sha256(dl.buffer)).toBe(sha256(data));
  });

  it("creates a public link on request", async () => {
    const { client } = await registerUser("up2");
    const data = randomData(500);
    const up = await uploadFile(client, { data, share: true });
    expect(up.file.share.token).toMatch(/^[0-9A-Za-z]{24}$/);
    const dl = await new Client().get(`/dl/${up.file.share.token}`);
    expect(dl.status).toBe(200);
    expect(sha256(dl.buffer)).toBe(sha256(data));
  });

  it("accepts chunks in any order and verifies the whole file", async () => {
    const { client } = await registerUser("order");
    for (const chunkOrder of ["desc", "shuffle"] as const) {
      const data = randomData(CHUNK * 5 + 17);
      const up = await uploadFile(client, { data, chunkOrder, share: false });
      expect(up.file.sha256).toBe(sha256(data));
      expect(sha256((await client.get(`/api/v1/files/${up.file.id}/download`)).buffer)).toBe(sha256(data));
    }
  });

  it("resumes an interrupted upload from the server's list of received chunks", async () => {
    const { client } = await registerUser("resume");
    const data = randomData(CHUNK * 6 + 5);
    const up = (await client.post("/api/v1/uploads", { fileName: "resume.bin", size: data.length })).body.upload;
    for (const i of [0, 1, 4]) expect((await putChunk(client, up, data, i)).status).toBe(200);

    const status = await client.get(`/api/v1/uploads/${up.id}`);
    expect(status.body.upload.received).toEqual([0, 1, 4]);
    expect(status.body.upload.status).toBe("active");

    const early = await client.post(`/api/v1/uploads/${up.id}/complete`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("incomplete_upload");
    expect(early.body.error.details.missing).toEqual([2, 3, 5, 6]);

    for (const i of [2, 3, 5, 6]) expect((await putChunk(client, up, data, i)).status).toBe(200);
    const done = await client.post(`/api/v1/uploads/${up.id}/complete?wait=30`, { sha256: sha256(data) });
    expect(done.body.upload.status).toBe("complete");
    expect(done.body.upload.file.sha256).toBe(sha256(data));
  });

  it("handles chunk retries: duplicates are idempotent, corrupted chunks are rejected and not recorded", async () => {
    const { client } = await registerUser("retry");
    const data = randomData(CHUNK * 3);
    const up = (await client.post("/api/v1/uploads", { fileName: "retry.bin", size: data.length })).body.upload;
    expect((await putChunk(client, up, data, 0)).status).toBe(200);
    expect((await putChunk(client, up, data, 0)).status).toBe(200);

    const corrupt = await putChunk(client, up, data, 1, true);
    expect(corrupt.status).toBe(422);
    expect(corrupt.body.error.code).toBe("checksum_mismatch");
    expect((await client.get(`/api/v1/uploads/${up.id}`)).body.upload.received).toEqual([0]);
    expect((await putChunk(client, up, data, 1)).status).toBe(200);

    const short = await client.fetch(`/api/v1/uploads/${up.id}/chunks/2`, { method: "PUT", body: new Uint8Array(100) });
    expect(short.status).toBe(400);
    expect((await client.fetch(`/api/v1/uploads/${up.id}/chunks/99`, { method: "PUT", body: new Uint8Array(CHUNK) })).status).toBe(422);

    expect((await putChunk(client, up, data, 2)).status).toBe(200);
    const done = await client.post(`/api/v1/uploads/${up.id}/complete?wait=30`, { sha256: sha256(data) });
    expect(done.body.upload.file.sha256).toBe(sha256(data));
  });

  it("rejects a whole-file checksum that doesn't match what the server computed", async () => {
    const { client } = await registerUser("badsum");
    const data = randomData(CHUNK + 10);
    const up = (await client.post("/api/v1/uploads", { fileName: "badsum.bin", size: data.length })).body.upload;
    for (let i = 0; i < up.totalChunks; i++) await putChunk(client, up, data, i);
    await client.post(`/api/v1/uploads/${up.id}/complete?wait=30`, { sha256: "f".repeat(64) });
    const final = await waitFor(async () => {
      const s = (await client.get(`/api/v1/uploads/${up.id}`)).body.upload;
      return s.status === "finalizing" ? null : s;
    });
    expect(final.status).toBe("failed");
    expect(final.file).toBeNull();
    expect(final.error).toMatch(/checksum/i);
    expect((await client.get("/api/v1/files")).body.files.find((f: any) => f.name === "badsum.bin")).toBeUndefined();
  });

  it("cancels an upload and refuses further data", async () => {
    const { client } = await registerUser("cancel");
    const data = randomData(CHUNK * 2);
    const up = (await client.post("/api/v1/uploads", { fileName: "cancel.bin", size: data.length })).body.upload;
    await putChunk(client, up, data, 0);
    expect((await client.del(`/api/v1/uploads/${up.id}`)).status).toBe(204);
    const after = await putChunk(client, up, data, 1);
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe("upload_closed");
  });

  it("keeps upload sessions private to their owner", async () => {
    const { client: owner } = await registerUser("owner");
    const data = randomData(CHUNK);
    const up = (await owner.post("/api/v1/uploads", { fileName: "mine.bin", size: data.length })).body.upload;
    expect((await new Client().get(`/api/v1/uploads/${up.id}`)).status).toBe(401);
    const { client: other } = await registerUser("other");
    expect((await other.get(`/api/v1/uploads/${up.id}`)).status).toBe(404);
    expect((await putChunk(other, up, data, 0)).status).toBe(404);
    expect((await other.del(`/api/v1/uploads/${up.id}`)).status).toBe(404);
  });

  it("validates upload requests", async () => {
    const { client: c } = await registerUser("valid");
    expect((await c.post("/api/v1/uploads", { fileName: "empty.bin", size: 0 })).status).toBe(422);
    expect((await c.post("/api/v1/uploads", { fileName: "", size: 10 })).status).toBe(422);
    expect((await c.post("/api/v1/uploads", { fileName: "a.bin", size: 1.5 })).status).toBe(422);
    const notJson = await c.fetch("/api/v1/uploads", { method: "POST", body: "{nope", headers: { "content-type": "application/json" } });
    expect(notJson.status).toBe(400);
    const past = await c.post("/api/v1/uploads", { fileName: "a.bin", size: 10, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(past.status).toBe(422);
    const ok = await c.post("/api/v1/uploads", { fileName: "a.bin", size: 10, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(ok.status).toBe(201);
  });
});

describe("plan limits and settings", () => {
  it("enforces the per-file limit, the storage quota and blocked types server-side", async () => {
    const { client, id } = await registerUser("limits");
    await setUserLimits(admin, id, { maxFileBytes: 1024 * 1024, quotaBytes: 150 * 1024 });
    const tooBig = await client.post("/api/v1/uploads", { fileName: "big.bin", size: 2 * 1024 * 1024 });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe("file_too_large");

    expect((await uploadFile(client, { data: randomData(100 * 1024) })).file.status).toBe("available");
    const over = await client.post("/api/v1/uploads", { fileName: "over.bin", size: 100 * 1024 });
    expect(over.status).toBe(507);
    expect(over.body.error.code).toBe("quota_exceeded");
    const cfg = (await client.get("/api/v1/config")).body.config;
    expect(cfg.usage.usedBytes).toBe(100 * 1024);
    expect(cfg.limits.quotaBytes).toBe(150 * 1024);

    const blocked = await client.post("/api/v1/uploads", { fileName: "installer.scr", size: 100 });
    expect(blocked.status).toBe(415);
    expect(blocked.body.error.code).toBe("blocked_file_type");
  });

  it("uses the plan's limits for a plan-assigned account", async () => {
    const { client } = await registerUser("freeplan");
    const me = (await client.get("/api/v1/auth/me")).body;
    expect(me.plan.key).toBe("free");
    expect(me.plan.limits.maxFileBytes).toBe(1024 ** 3);
    const tooBig = await client.post("/api/v1/uploads", { fileName: "huge.bin", size: 2 * 1024 ** 3 });
    expect(tooBig.status).toBe(413);
  });

  it("supports the allow-list of extensions", async () => {
    const { client } = await registerUser("allow");
    await setSettings(admin, { files: { allowedExtensions: ["txt"] } });
    expect((await client.post("/api/v1/uploads", { fileName: "ok.txt", size: 10 })).status).toBe(201);
    expect((await client.post("/api/v1/uploads", { fileName: "no.png", size: 10 })).status).toBe(415);
    await setSettings(admin, { files: { allowedExtensions: [] } });
  });

  it("blocks uploads during maintenance mode but keeps downloads working", async () => {
    const { client } = await registerUser("maint");
    const before = await uploadFile(client, { data: randomData(500), share: true });
    await setSettings(admin, { maintenance: { enabled: true, message: "Back soon", disableUploads: true, allowDownloads: true } });
    const blocked = await client.post("/api/v1/uploads", { fileName: "x.bin", size: 10 });
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe("maintenance");
    expect(blocked.body.error.message).toBe("Back soon");
    expect((await new Client().get(`/dl/${before.file.share.token}`)).status).toBe(200);
    await setSettings(admin, { maintenance: { allowDownloads: false } });
    expect((await new Client().get(`/dl/${before.file.share.token}`)).status).toBe(503);
    await setSettings(admin, { maintenance: { enabled: false, allowDownloads: true } });
    expect((await new Client().get(`/dl/${before.file.share.token}`)).status).toBe(200);
  });
});

describe("filename and content-type safety", () => {
  it("sanitizes hostile file names and never uses them as paths", async () => {
    const { client: c } = await registerUser("names");
    const cases: Array<[string, (n: string) => void]> = [
      ["../../etc/passwd", (n) => expect(n).toBe("passwd")],
      ["..\\..\\windows\\system32\\evil.dll", (n) => expect(n).toBe("evil.dll")],
      ["invoice‮gpj.exe", (n) => expect(n).not.toMatch(/[‮]/)],
      ["CON.txt", (n) => expect(n).toBe("_CON.txt")],
      ["null\u0000byte.txt", (n) => expect(n).toBe("nullbyte.txt")],
      ["trailing dots...", (n) => expect(n).toBe("trailing dots")],
      ["x".repeat(400) + ".txt", (n) => expect(Buffer.byteLength(n)).toBeLessThanOrEqual(240)],
    ];
    for (const [name, check] of cases) {
      const up = await uploadFile(c, { data: randomData(64), name, share: false });
      expect(up.file, `upload of ${JSON.stringify(name)}`).toBeTruthy();
      check(up.file.name);
    }
  });

  it("detects the real content type from the bytes, not from the name or the client", async () => {
    const { client } = await registerUser("mime");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const a = await uploadFile(client, { data: png, name: "actually-a-png.txt", share: false });
    expect(a.file.mime).toBe("image/png");
    expect(a.file.category).toBe("image");
    const b = await uploadFile(client, { data: Buffer.from("<html><script>alert(1)</script></html>"), name: "page.html", share: false });
    expect(b.file.previewKind).toBe("text"); // shown as inert text, never rendered
  });
});

describe("one-request API uploads", () => {
  it("accepts multipart form uploads with options and returns the link", async () => {
    const { client } = await registerUser("multipart");
    const data = randomData(5000);
    const form = new FormData();
    form.set("password", "s3cret-link");
    form.set("file", new Blob([new Uint8Array(data)]), "form upload.bin");
    const res = await client.fetch("/api/v1/files", { method: "POST", body: form });
    expect(res.status).toBe(201);
    expect(res.body.file).toMatchObject({ name: "form upload.bin", size: 5000, sha256: sha256(data) });
    expect(res.body.file.share.hasPassword).toBe(true);
    expect(res.body.shareUrl).toContain("/d/");
  });

  it("keeps one-request uploads private unless a link is asked for or implied", async () => {
    const { client } = await registerUser("privatedefault");
    const plain = await client.fetch("/api/v1/files?name=plain.bin", { method: "POST", body: new Uint8Array(randomData(400)), headers: { "content-type": "application/octet-stream" } });
    expect(plain.status).toBe(201);
    expect(plain.body.file.share).toBeNull();
    expect(plain.body.shareUrl).toBeNull();
    const asked = await client.fetch("/api/v1/files?name=asked.bin&share=true", { method: "POST", body: new Uint8Array(randomData(400)), headers: { "content-type": "application/octet-stream" } });
    expect(asked.body.shareUrl).toContain("/d/");
  });

  it("accepts raw bodies", async () => {
    const { client } = await registerUser("raw");
    const data = randomData(3000);
    const res = await client.fetch("/api/v1/files?name=raw.bin&share=false", { method: "POST", body: new Uint8Array(data), headers: { "content-type": "application/octet-stream" } });
    expect(res.status).toBe(201);
    expect(res.body.file.sha256).toBe(sha256(data));
    expect(res.body.file.share).toBeNull();
  });

  it("verifies a supplied sha256 and rejects oversized or nameless uploads", async () => {
    const { client, id } = await registerUser("oneshot");
    const data = randomData(2000);
    const mismatch = await client.fetch(`/api/v1/files?name=x.bin&sha256=${"a".repeat(64)}`, { method: "POST", body: new Uint8Array(data) });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe("checksum_mismatch");
    expect((await client.fetch("/api/v1/files", { method: "POST", body: new Uint8Array(data) })).status).toBe(400);
    await setUserLimits(admin, id, { maxFileBytes: 1000 });
    const big = await client.fetch("/api/v1/files?name=big.bin", { method: "POST", body: new Uint8Array(data) });
    expect(big.status).toBe(413);
  });
});

describe("account uploads", () => {
  it("stores files in folders and supports 'never' expiry", async () => {
    const { client } = await registerUser("acct");
    const folder = (await client.post("/api/v1/folders", { name: "Docs" })).body.folder;
    const data = randomData(CHUNK * 2 + 3);
    const withFolder = await uploadFile(client, { data, name: "in-folder.bin", folderId: folder.id, share: false });
    expect(withFolder.file.folderId).toBe(folder.id);
    expect(withFolder.file.share).toBeNull();
    expect(withFolder.file.expiresAt).toBeNull();
    const list = await client.get(`/api/v1/files?folderId=${folder.id}`);
    expect(list.body.files).toHaveLength(1);
    expect(list.body.breadcrumbs.map((b: any) => b.name)).toEqual(["All files", "Docs"]);
    const { client: other } = await registerUser("other2");
    expect((await other.post("/api/v1/uploads", { fileName: "x.bin", size: 10, folderId: folder.id })).status).toBe(404);
  });

  it("uploads a large multi-chunk file and serves it back intact", async () => {
    const { client } = await registerUser("large");
    await setSettings(admin, { uploads: { chunkSizeBytes: 1024 * 1024 } });
    const data = randomData(24 * 1024 * 1024 + 321);
    const up = await uploadFile(client, { data, name: "large.bin", share: false });
    await setSettings(admin, { uploads: { chunkSizeBytes: CHUNK } });
    expect(up.init.body.upload.totalChunks).toBe(25);
    expect(up.file.sha256).toBe(sha256(data));
    const dl = await client.get(`/api/v1/files/${up.file.id}/download`);
    expect(dl.status).toBe(200);
    expect(sha256(dl.buffer)).toBe(sha256(data));
    const tail = await client.get(`/api/v1/files/${up.file.id}/download`, { headers: { range: `bytes=${data.length - 1000}-` } });
    expect(tail.status).toBe(206);
    expect(tail.buffer.equals(data.subarray(data.length - 1000))).toBe(true);
  });
});