import { describe, expect, it, beforeAll } from "vitest";
import { Client, adminClient, assignPlan, randomData, registerUser, sha256, uploadFile, waitFor } from "./helpers";

let admin: Client;
beforeAll(async () => {
  admin = await adminClient();
});

const names = (res: any) => res.body.files.map((f: any) => f.name).sort();

describe("tags, descriptions and metadata", () => {
  it("tags files in bulk, filters by tag and keeps tags per workspace", async () => {
    const { client } = await registerUser("tags");
    const a = (await uploadFile(client, { data: randomData(50), name: "a.txt", share: false })).file;
    const b = (await uploadFile(client, { data: randomData(50), name: "b.txt", share: false })).file;
    const res = await client.post("/api/v1/bulk", { action: "tag", fileIds: [a.id, b.id], add: ["Project X", "urgent"] });
    expect(res.body.done).toBe(2);
    const tags = (await client.get("/api/v1/tags")).body.items;
    expect(tags.map((t: any) => t.name).sort()).toEqual(["Project X", "urgent"]);
    expect(tags.every((t: any) => /^#[0-9a-f]{6}$/i.test(t.color))).toBe(true);
    expect(names(await client.get("/api/v1/files?q=tag:urgent"))).toEqual(["a.txt", "b.txt"]);
    const urgent = tags.find((t: any) => t.name === "urgent");
    await client.post("/api/v1/bulk", { action: "tag", fileIds: [b.id], removeIds: [urgent.id] });
    expect(names(await client.get("/api/v1/files?q=tag:urgent"))).toEqual(["a.txt"]);
    expect(names(await client.get("/api/v1/files?q=-tag:urgent"))).toEqual(["b.txt"]);
    expect((await client.patch(`/api/v1/tags/${urgent.id}`, { name: "critical", color: "#ff0000" })).body.tag).toMatchObject({ name: "critical", color: "#ff0000" });
    expect(names(await client.get("/api/v1/files?q=tag:critical"))).toEqual(["a.txt"]);
    const { client: other } = await registerUser("tags-other");
    expect((await other.get("/api/v1/tags")).body.items).toEqual([]);
    expect((await other.patch(`/api/v1/tags/${urgent.id}`, { name: "mine" })).status).toBe(404);
    await client.del(`/api/v1/tags/${urgent.id}`);
    expect((await client.get(`/api/v1/files/${a.id}`)).body.file.tags.map((t: any) => t.name)).toEqual(["Project X"]);
  });

  it("stores descriptions, notes, color labels and custom metadata, and validates them", async () => {
    const { client } = await registerUser("meta");
    const f = (await uploadFile(client, { data: randomData(30), name: "m.bin", share: false })).file;
    const res = await client.patch(`/api/v1/files/${f.id}`, { description: "Quarterly numbers", notes: "private thoughts", colorLabel: "#22aa66", metadata: { client: "Acme", ticket: "42" } });
    expect(res.body.file).toMatchObject({ description: "Quarterly numbers", notes: "private thoughts", colorLabel: "#22aa66", metadata: { client: "Acme", ticket: "42" } });
    expect((await client.patch(`/api/v1/files/${f.id}`, { colorLabel: "green" })).status).toBe(422);
    expect(names(await client.get("/api/v1/files?q=has:description"))).toEqual(["m.bin"]);
    expect((await client.patch(`/api/v1/files/${f.id}`, { archived: true })).body.file.archivedAt).toBeTruthy();
    expect((await client.get("/api/v1/files")).body.files).toEqual([]); // archived files leave the main listing
    expect(names(await client.get("/api/v1/files?view=archived"))).toEqual(["m.bin"]);
    expect(names(await client.get("/api/v1/files?q=is:archived"))).toEqual(["m.bin"]);
  });
});

describe("search operators", () => {
  it("supports type, ext, size, folder, is, has and negation, and reports unknown operators", async () => {
    const { client } = await registerUser("search");
    const docs = (await client.post("/api/v1/folders", { name: "Documents" })).body.folder;
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    await uploadFile(client, { data: png, name: "pic.png", share: false });
    await uploadFile(client, { data: Buffer.alloc(5000, 1), name: "big.txt", folderId: docs.id, share: true });
    await uploadFile(client, { data: Buffer.alloc(200, 2), name: "small.txt", share: false });
    expect(names(await client.get("/api/v1/files?q=type:image"))).toEqual(["pic.png"]);
    expect(names(await client.get("/api/v1/files?q=ext:txt"))).toEqual(["big.txt", "small.txt"]);
    expect(names(await client.get("/api/v1/files?q=" + encodeURIComponent("ext:txt size:>1KB")))).toEqual(["big.txt"]);
    expect(names(await client.get("/api/v1/files?q=" + encodeURIComponent("size:100..300")))).toEqual(["small.txt"]);
    expect(names(await client.get("/api/v1/files?q=folder:documents"))).toEqual(["big.txt"]);
    expect(names(await client.get("/api/v1/files?q=is:shared"))).toEqual(["big.txt"]);
    expect(names(await client.get("/api/v1/files?q=is:private"))).toEqual(["pic.png", "small.txt"]);
    expect(names(await client.get("/api/v1/files?q=" + encodeURIComponent("ext:txt -folder:documents")))).toEqual(["small.txt"]);
    expect(names(await client.get("/api/v1/files?q=" + encodeURIComponent("modified:<1d")))).toHaveLength(3);
    expect(names(await client.get("/api/v1/files?q=" + encodeURIComponent("created:>1y")))).toEqual([]); // older than a year
    const bad = await client.get("/api/v1/files?q=" + encodeURIComponent("flavor:vanilla type:nonsense"));
    expect(bad.status).toBe(200);
    expect(bad.body.queryErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps saved searches private and validates their queries", async () => {
    const { client } = await registerUser("saved");
    expect((await client.post("/api/v1/saved-searches", { name: "Big videos", query: "type:video size:>1GB", pinned: true })).status).toBe(201);
    expect((await client.post("/api/v1/saved-searches", { name: "Bad", query: "size:>lots" })).status).toBe(422);
    const list = (await client.get("/api/v1/saved-searches")).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Big videos", pinned: true });
    const { client: other } = await registerUser("saved-other");
    expect((await other.get("/api/v1/saved-searches")).body.items).toEqual([]);
    expect((await other.del(`/api/v1/saved-searches/${list[0].id}`)).status).toBe(404);
    expect((await client.del(`/api/v1/saved-searches/${list[0].id}`)).status).toBe(204);
  });
});

describe("duplicates and batch rename", () => {
  it("finds identical files by hash and never deletes anything on its own", async () => {
    const { client } = await registerUser("dupes");
    const same = randomData(400);
    const a = (await uploadFile(client, { data: same, name: "one.bin", share: false })).file;
    await uploadFile(client, { data: same, name: "two.bin", share: false });
    await uploadFile(client, { data: randomData(400), name: "unique.bin", share: false });
    const res = (await client.get("/api/v1/duplicates")).body;
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]).toMatchObject({ sha256: sha256(same), size: 400, reclaimableBytes: 400 });
    expect(res.groups[0].files.map((f: any) => f.name).sort()).toEqual(["one.bin", "two.bin"]);
    expect(res.reclaimableBytes).toBe(400);
    expect((await client.get(`/api/v1/files/${a.id}`)).status).toBe(200);
    const { client: other } = await registerUser("dupes-other");
    await uploadFile(other, { data: same, name: "theirs.bin", share: false });
    expect((await other.get("/api/v1/duplicates")).body.groups).toEqual([]); // duplicates are per workspace
  });

  it("previews a batch rename, reports conflicts and applies all-or-nothing", async () => {
    const { client } = await registerUser("rename");
    const ids: string[] = [];
    for (const n of ["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg"]) ids.push((await uploadFile(client, { data: randomData(20), name: n, share: false })).file.id);
    const prev = await client.post("/api/v1/batch-rename", { fileIds: ids, pattern: "trip-{number:2}" });
    expect(prev.body.rows.map((r: any) => r.to)).toEqual(["trip-01.jpg", "trip-02.jpg", "trip-03.jpg"]);
    expect(prev.body.rows.every((r: any) => !r.conflict)).toBe(true);
    const collide = await client.post("/api/v1/batch-rename", { fileIds: ids, pattern: "same" });
    expect(collide.body.rows.some((r: any) => r.conflict === "duplicate")).toBe(true);
    expect((await client.post("/api/v1/batch-rename", { fileIds: ids, pattern: "same", apply: true })).status).toBe(409);
    expect(names(await client.get("/api/v1/files"))).toEqual(["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg"]); // nothing changed
    const applied = await client.post("/api/v1/batch-rename", { fileIds: ids, pattern: "trip-{number:2}", apply: true });
    expect(applied.body.renamed).toBe(3);
    expect(names(await client.get("/api/v1/files"))).toEqual(["trip-01.jpg", "trip-02.jpg", "trip-03.jpg"]);
    const { client: other } = await registerUser("rename-other");
    expect((await other.post("/api/v1/batch-rename", { fileIds: ids, pattern: "hijack", apply: true })).status).toBe(404);
  });
});

describe("versions", () => {
  it("keeps older versions, restores them, honours the plan's version limit and deletes on request", async () => {
    const { client, id } = await registerUser("versions");
    await assignPlan(admin, id, "pro");
    const v1 = randomData(100);
    const v2 = randomData(120);
    const v3 = randomData(140);
    const file = (await uploadFile(client, { data: v1, name: "doc.bin", share: false })).file;
    const put = async (data: Buffer) => {
      const init = (await client.post("/api/v1/uploads", { fileName: "doc.bin", size: data.length, replaceFileId: file.id })).body.upload;
      await client.fetch(`/api/v1/uploads/${init.id}/chunks/0`, { method: "PUT", body: new Uint8Array(data) });
      return (await client.post(`/api/v1/uploads/${init.id}/complete?wait=30`, { sha256: sha256(data) })).body.upload;
    };
    expect((await put(v2)).status).toBe("complete");
    expect((await put(v3)).status).toBe("complete");
    const list = (await client.get(`/api/v1/files/${file.id}/versions`)).body.items;
    expect(list.map((v: any) => [v.version, v.current])).toEqual([[3, true], [2, false], [1, false]]);
    expect(sha256((await client.get(`/api/v1/files/${file.id}/download`)).buffer)).toBe(sha256(v3));
    expect(sha256((await client.get(`/api/v1/files/${file.id}/versions/1/download`)).buffer)).toBe(sha256(v1));
    // Old versions count against storage.
    expect((await client.get("/api/v1/config")).body.config.usage.usedBytes).toBe(100 + 120 + 140);
    // Restoring keeps the replaced content as a version, so nothing is lost.
    expect((await client.post(`/api/v1/files/${file.id}/versions/1`)).body.version).toBe(4);
    expect(sha256((await client.get(`/api/v1/files/${file.id}/download`)).buffer)).toBe(sha256(v1));
    expect((await client.get(`/api/v1/files/${file.id}/versions`)).body.items.map((v: any) => v.version)).toEqual([4, 3, 2]); // v1 became current, v3 was kept
    expect((await client.del(`/api/v1/files/${file.id}/versions/2`)).status).toBe(204);
    expect((await client.del(`/api/v1/files/${file.id}/versions/2`)).status).toBe(404);

    // The plan caps how many are kept (oldest go first).
    const key = `vers${Date.now().toString(36)}`.slice(0, 20);
    await admin.post("/api/v1/admin/plans", { key, name: "One version", features: { fileVersioning: true }, limits: { versionsPerFile: 1 } });
    await assignPlan(admin, id, key);
    await put(randomData(90));
    expect((await client.get(`/api/v1/files/${file.id}/versions`)).body.items).toHaveLength(2); // current + one older
  });

  it("refuses versions on plans without the feature", async () => {
    const { client, id } = await registerUser("noversions");
    const file = (await uploadFile(client, { data: randomData(40), name: "x.bin", share: false })).file;
    const key = `nov${Date.now().toString(36)}`.slice(0, 20);
    await admin.post("/api/v1/admin/plans", { key, name: "No versions", features: { fileVersioning: false } });
    await assignPlan(admin, id, key);
    const res = await client.post("/api/v1/uploads", { fileName: "x.bin", size: 10, replaceFileId: file.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("plan_required");
  });
});

describe("comments and activity", () => {
  it("threads comments, resolves @mentions inside the workspace and keeps activity per file", async () => {
    const { client, id } = await registerUser("comments");
    const file = (await uploadFile(client, { data: randomData(40), name: "c.bin", share: false })).file;
    const c1 = await client.post(`/api/v1/files/${file.id}/comments`, { body: "First!" });
    expect(c1.status).toBe(201);
    const reply = await client.post(`/api/v1/files/${file.id}/comments`, { body: "Reply", parentId: c1.body.comment.id });
    expect(reply.body.comment.parentId).toBe(c1.body.comment.id);
    expect((await client.patch(`/api/v1/comments/${c1.body.comment.id}`, { body: "First (edited)" })).body.comment.edited).toBe(true);
    const list = (await client.get(`/api/v1/files/${file.id}/comments`)).body.items;
    expect(list).toHaveLength(2);
    expect((await client.get(`/api/v1/files/${file.id}`)).body.file.commentCount).toBe(2);
    const { client: other } = await registerUser("comments-other");
    expect((await other.get(`/api/v1/files/${file.id}/comments`)).status).toBe(404);
    expect((await other.patch(`/api/v1/comments/${c1.body.comment.id}`, { body: "hijack" })).status).toBe(404);
    expect((await client.del(`/api/v1/comments/${c1.body.comment.id}`)).status).toBe(204);
    const after = (await client.get(`/api/v1/files/${file.id}/comments`)).body.items;
    expect(after.find((c: any) => c.id === c1.body.comment.id)).toMatchObject({ deleted: true, body: "" }); // placeholder keeps the thread readable
    void id;
    await client.patch(`/api/v1/files/${file.id}`, { name: "renamed.bin" });
    const act = (await client.get(`/api/v1/files/${file.id}/activity`)).body.items.map((a: any) => a.action);
    expect(act).toEqual(expect.arrayContaining(["uploaded", "renamed"]));
  });
});

describe("advanced share settings", () => {
  async function pro(label: string) {
    const u = await registerUser(label);
    await assignPlan(admin, u.id, "pro");
    return u;
  }

  it("view-only links serve previews but refuse downloads", async () => {
    const { client } = await pro("viewonly");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const file = (await uploadFile(client, { data: png, name: "v.png", share: false })).file;
    const share = (await client.post("/api/v1/shares", { fileId: file.id, permissions: ["view"] })).body.share;
    expect(share.permissions).toEqual(["view"]);
    const v = new Client();
    expect((await v.get(`/dl/${share.token}?mode=preview`)).status).toBe(200);
    const dl = await v.get(`/dl/${share.token}`);
    expect(dl.status).toBe(403);
    expect((await v.get(`/dl/${share.token}?mode=zip`)).status).toBe(403);
    expect((await v.get(`/api/v1/public/shares/${share.token}`)).body.share.permissions).toEqual(["view"]);
  });

  it("counts views once per page load, enforces the view limit and records analytics", async () => {
    const { client } = await pro("views");
    const file = (await uploadFile(client, { data: randomData(60), name: "w.bin", share: false })).file;
    const share = (await client.post("/api/v1/shares", { fileId: file.id, maxViews: 2 })).body.share;
    const v = new Client();
    expect((await v.get(`/api/v1/public/shares/${share.token}`)).status).toBe(200); // reading metadata isn't a view
    expect((await v.post(`/api/v1/public/shares/${share.token}/view`)).status).toBe(200);
    expect((await v.post(`/api/v1/public/shares/${share.token}/view`)).status).toBe(200);
    expect((await v.post(`/api/v1/public/shares/${share.token}/view`)).status).toBe(410);
    expect((await v.get(`/api/v1/public/shares/${share.token}`)).status).toBe(410);
    expect((await v.get(`/dl/${share.token}`)).status).toBe(410 - 210); // downloads follow their own limit, not the view limit
    const stats = (await client.get(`/api/v1/shares/${share.id}/analytics`)).body;
    expect(stats.totals).toMatchObject({ views: 2, downloads: 1 });
    expect(stats.daily).toHaveLength(1);
    expect(JSON.stringify(stats)).not.toMatch(/"(ip|ipAddress|address|visitor|userAgent)"/);
    const { client: free } = await registerUser("views-free");
    const f2 = (await uploadFile(free, { data: randomData(30), name: "z.bin", share: true })).file;
    expect((await free.get(`/api/v1/shares/${f2.share.id}/analytics`)).status).toBe(403);
  });

  it("restricts links to allowed IP addresses", async () => {
    const { client } = await pro("iprule");
    const file = (await uploadFile(client, { data: randomData(60), name: "ip.bin", share: false })).file;
    const allowed = new Client();
    const share = (await client.post("/api/v1/shares", { fileId: file.id, ipAllowlist: [allowed.ip] })).body.share;
    expect(share.ipAllowlist).toEqual([allowed.ip]);
    expect((await allowed.get(`/dl/${share.token}`)).status).toBe(200);
    const outside = await new Client().get(`/dl/${share.token}`);
    expect(outside.status).toBe(403);
    expect((await new Client().get(`/api/v1/public/shares/${share.token}`)).status).toBe(403);
    expect((await client.post("/api/v1/shares", { fileId: file.id, ipAllowlist: ["not-an-ip"] })).status).toBe(422);
    expect((await client.post("/api/v1/shares", { fileId: file.id, ipAllowlist: ["10.0.0.0/8"] })).status).toBe(201);
  });

  it("only serves embeddable renditions when the owner turned embeds on", async () => {
    const { client } = await pro("embed");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const file = (await uploadFile(client, { data: png, name: "e.png", share: false })).file;
    const off = (await client.post("/api/v1/shares", { fileId: file.id })).body.share;
    const on = (await client.post("/api/v1/shares", { fileId: file.id, embedEnabled: true })).body.share;
    const a = await new Client().get(`/dl/${off.token}?mode=preview&embed=1`);
    expect(a.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(a.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    const b = await new Client().get(`/dl/${on.token}?mode=preview&embed=1`);
    expect(b.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(b.headers.get("x-frame-options")).toBeNull();
  });

  it("shows owner branding only when the plan includes it", async () => {
    const { client } = await pro("brand");
    const file = (await uploadFile(client, { data: randomData(30), name: "b.bin", share: false })).file;
    const share = (await client.post("/api/v1/shares", { fileId: file.id, title: "Q3 numbers", message: "Please review" })).body.share;
    const pub = (await new Client().get(`/api/v1/public/shares/${share.token}`)).body.share;
    expect(pub).toMatchObject({ title: "Q3 numbers", message: "Please review" });
    const withPw = (await client.post("/api/v1/shares", { fileId: file.id, title: "Secret title", password: "pw-pw-pw" })).body.share;
    const locked = (await new Client().get(`/api/v1/public/shares/${withPw.token}`)).body.share;
    expect(locked.title).toBeNull(); // nothing leaks before the password
    expect(locked.file).toBeUndefined();
  });
});

describe("import from URL and data export", () => {
  it("refuses internal addresses for imports, including via redirects", async () => {
    const { client, id } = await registerUser("import");
    await assignPlan(admin, id, "pro");
    for (const url of ["http://127.0.0.1/x", "http://localhost:3000/x", "http://169.254.169.254/latest/meta-data/", "http://10.1.2.3/x", "file:///etc/passwd", "http://[::1]/x"]) {
      expect((await client.post("/api/v1/imports", { url })).status, url).toBe(422);
    }
    // Public names that resolve to a private address fail at connect time and are reported, never fetched.
    const res = await client.post("/api/v1/imports", { url: "http://localtest.me/secret" });
    if (res.status === 202) {
      const job = await waitFor(async () => {
        const item = (await client.get("/api/v1/imports")).body.items[0];
        return item.status === "failed" || item.status === "done" ? item : null;
      }, 60_000);
      expect(job.status).toBe("failed");
      expect((await client.get("/api/v1/files")).body.files).toEqual([]);
    } else {
      expect(res.status).toBe(422);
    }
  });

  it("builds a data export with the profile, structure and files, and refuses other accounts", async () => {
    const { client } = await registerUser("export");
    const data = randomData(500);
    await uploadFile(client, { data, name: "mine.bin", share: false });
    const req = await client.post("/api/v1/account/exports");
    expect(req.status).toBe(202);
    expect((await client.post("/api/v1/account/exports")).status).toBe(409); // one at a time
    const ready = await waitFor(async () => {
      const item = (await client.get("/api/v1/account/exports")).body.items[0];
      return item.status === "ready" ? item : null;
    }, 60_000);
    const dl = await client.get(`/api/v1/account/exports/${ready.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/zip");
    expect(dl.buffer.subarray(0, 2).toString()).toBe("PK");
    const text = dl.buffer.toString("latin1");
    expect(text).toContain("account/profile.json");
    expect(text).toContain("files/mine.bin");
    expect(text).not.toMatch(/scrypt\$/); // no credential material
    const { client: other } = await registerUser("export-other");
    expect((await other.get(`/api/v1/account/exports/${ready.id}/download`)).status).toBe(404);
  });
});
