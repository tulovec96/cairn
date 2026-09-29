import { afterAll, describe, expect, it } from "vitest";
import { Client, adminClient, assignPlan, randomData, registerUser, setSettings, uploadFile } from "./helpers";

afterAll(async () => {
  const admin = await adminClient();
  await setSettings(admin, { maintenance: { enabled: false } });
});

describe("overview and listings", () => {
  it("shows real, consistent statistics", async () => {
    const admin = await adminClient();
    const { client } = await registerUser("stats");
    const before = (await admin.get("/api/v1/admin/overview")).body;
    const { client: second } = await registerUser("stats2");
    await uploadFile(client, { data: randomData(5000), share: true, expiresAt: null });
    await uploadFile(second, { data: randomData(3000), share: true });
    const after = (await admin.get("/api/v1/admin/overview")).body;
    expect(after.files - before.files).toBe(2);
    expect(after.storageBytes - before.storageBytes).toBe(8000);
    expect(after.activeShares - before.activeShares).toBe(2);
    expect(after.storage.ok).toBe(true);
    // An object store has no meaningful "free space"; local disk does.
    if (process.env.STORAGE_PROVIDER === "s3") expect(after.storage.freeBytes).toBeNull();
    else expect(after.storage.freeBytes).toBeGreaterThan(0);
    expect(after.users).toBeGreaterThanOrEqual(2);
  });

  it("searches and paginates users, and inspects one", async () => {
    const admin = await adminClient();
    const a = await registerUser("findme-alpha");
    await registerUser("findme-beta");
    const found = await admin.get("/api/v1/admin/users?q=findme-");
    expect(found.body.items.length).toBeGreaterThanOrEqual(2);
    expect(found.body.items.every((u: any) => u.email.includes("findme-"))).toBe(true);
    expect(JSON.stringify(found.body)).not.toMatch(/passwordHash|scrypt/);
    const page1 = await admin.get("/api/v1/admin/users?limit=1");
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await admin.get(`/api/v1/admin/users?limit=1&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);

    await uploadFile(a.client, { data: randomData(1234), share: false, expiresAt: null });
    const detail = await admin.get(`/api/v1/admin/users/${a.id}`);
    expect(detail.body.user.email).toBe(a.email);
    expect(detail.body.usage.usedBytes).toBe(1234);
    expect(detail.body.counts.files).toBe(1);
    expect(detail.body.recentFiles[0].name).toBeTruthy();
    expect(JSON.stringify(detail.body)).not.toMatch(/passwordHash|scrypt/);
  });

  it("searches files across owners without exposing contents", async () => {
    const admin = await adminClient();
    const { client, email } = await registerUser("filesearch");
    const up = await uploadFile(client, { data: randomData(400), name: "needle-in-haystack.dat", share: false, expiresAt: null });
    const byName = await admin.get("/api/v1/admin/files?q=needle-in-hay");
    expect(byName.body.items.map((f: any) => f.id)).toContain(up.file.id);
    expect(byName.body.items[0].ownerEmail).toBe(email);
    expect((await admin.get(`/api/v1/admin/files?q=${up.file.sha256}`)).body.items[0].id).toBe(up.file.id);
    expect((await admin.get(`/api/v1/admin/files?q=${email}`)).body.items.some((f: any) => f.id === up.file.id)).toBe(true);
    const detail = await admin.get(`/api/v1/admin/files/${up.file.id}`);
    expect(detail.body.file.sha256).toBe(up.file.sha256);
    expect(detail.body.storageKey).toBeTruthy();
    // There is deliberately no endpoint that returns a file's bytes to an administrator.
    expect((await admin.get(`/api/v1/files/${up.file.id}/download`)).status).toBe(404);
  });
});

describe("user management", () => {
  it("suspends, restores, changes roles and revokes sessions", async () => {
    const admin = await adminClient();
    const { client, id } = await registerUser("manage");
    expect((await admin.patch(`/api/v1/admin/users/${id}`, { role: "admin" })).body.user.role).toBe("admin");
    expect((await client.get("/api/v1/admin/overview")).status).toBe(200);
    expect((await admin.patch(`/api/v1/admin/users/${id}`, { role: "user" })).body.user.role).toBe("user");
    expect((await client.get("/api/v1/admin/overview")).status).toBe(403);
    expect((await admin.del(`/api/v1/admin/users/${id}/sessions`)).body.revoked).toBeGreaterThanOrEqual(1);
    expect((await client.get("/api/v1/files")).status).toBe(401);
  });

  it("protects the administrator from locking themselves out", async () => {
    const admin = await adminClient();
    const me = (await admin.get("/api/v1/auth/me")).body.user;
    expect((await admin.patch(`/api/v1/admin/users/${me.id}`, { status: "suspended" })).status).toBe(409);
    expect((await admin.patch(`/api/v1/admin/users/${me.id}`, { role: "user" })).status).toBe(409);
    expect((await admin.del(`/api/v1/admin/users/${me.id}`)).status).toBe(409);
    expect((await admin.patch("/api/v1/admin/users/usr_doesnotexist000", { status: "suspended" })).status).toBe(404);
  });

  it("applies per-user quota and file-size overrides", async () => {
    const admin = await adminClient();
    const { client, id } = await registerUser("quota");
    await admin.patch(`/api/v1/admin/users/${id}`, { quotaBytes: 10_000, maxFileBytes: 6_000 });
    const tooBig = await client.post("/api/v1/uploads", { fileName: "big.bin", size: 7000 });
    expect(tooBig.status).toBe(413);
    expect((await uploadFile(client, { data: randomData(6000), share: false, expiresAt: null })).file.status).toBe("available");
    const over = await client.post("/api/v1/uploads", { fileName: "over.bin", size: 5000 });
    expect(over.status).toBe(507);
    expect(over.body.error.code).toBe("quota_exceeded");
    expect(over.body.error.message).toMatch(/quota/i);
    // Trash counts until it's emptied — the message says how to free space, and doing so works.
    const list = (await client.get("/api/v1/files")).body.files;
    await client.del(`/api/v1/files/${list[0].id}`);
    expect((await client.post("/api/v1/uploads", { fileName: "still-over.bin", size: 5000 })).status).toBe(507);
    await client.del("/api/v1/trash");
    expect((await client.post("/api/v1/uploads", { fileName: "fits.bin", size: 5000 })).status).toBe(201);
    const cfg = (await client.get("/api/v1/config")).body.config;
    expect(cfg.limits).toMatchObject({ quotaBytes: 10_000, maxFileBytes: 6_000 });
    await admin.patch(`/api/v1/admin/users/${id}`, { quotaBytes: null, maxFileBytes: null });
    expect((await client.get("/api/v1/config")).body.config.limits.quotaBytes).toBeGreaterThan(10_000);
  });

  it("deletes an account, its files and its links", async () => {
    const admin = await adminClient();
    const { client, id } = await registerUser("adminremoves");
    const up = await uploadFile(client, { data: randomData(600), share: true, expiresAt: null });
    expect((await new Client().get(`/dl/${up.file.share.token}`)).status).toBe(200);
    expect((await admin.del(`/api/v1/admin/users/${id}`)).status).toBe(200);
    expect((await new Client().get(`/dl/${up.file.share.token}`)).status).toBe(404);
    expect((await admin.get(`/api/v1/admin/users/${id}`)).status).toBe(404);
  });
});

describe("files, quarantine and reports", () => {
  it("quarantines a file: downloads and links stop, the owner is notified, release restores", async () => {
    const admin = await adminClient();
    const { client } = await registerUser("quarantine");
    const up = await uploadFile(client, { data: randomData(700), name: "suspicious.bin", share: true, expiresAt: null });
    const token = up.file.share.token;
    expect((await new Client().get(`/dl/${token}`)).status).toBe(200);
    expect((await admin.post(`/api/v1/admin/files/${up.file.id}`, { action: "quarantine", note: "Flagged by review" })).status).toBe(200);

    const blocked = await new Client().get(`/dl/${token}`);
    expect(blocked.status).toBe(410); // its share links were revoked
    expect((await client.get(`/api/v1/files/${up.file.id}/download`)).status).toBe(403);
    expect((await client.get(`/api/v1/files/${up.file.id}/download`)).body.error.code).toBe("quarantined");
    expect((await client.post("/api/v1/shares", { fileId: up.file.id })).status).toBe(403);
    const details = (await client.get(`/api/v1/files/${up.file.id}`)).body.file;
    expect(details).toMatchObject({ status: "quarantined", quarantineNote: "Flagged by review" });
    const notes = (await client.get("/api/v1/notifications")).body;
    expect(notes.items.map((n: any) => n.type)).toEqual(expect.arrayContaining(["file_quarantined", "share_revoked"]));
    expect(notes.unread).toBeGreaterThanOrEqual(2);

    expect((await admin.post(`/api/v1/admin/files/${up.file.id}`, { action: "release" })).status).toBe(200);
    expect((await client.get(`/api/v1/files/${up.file.id}/download`)).status).toBe(200);
    expect((await admin.post(`/api/v1/admin/files/${up.file.id}`, { action: "rescan" })).status).toBe(409); // no scanner configured
    expect((await admin.post(`/api/v1/admin/files/${up.file.id}`, { action: "delete" })).body.deleted).toBe(true);
    expect((await client.get(`/api/v1/files/${up.file.id}`)).status).toBe(404);
  });

  it("runs the report review workflow and keeps the record after the file is deleted", async () => {
    const admin = await adminClient();
    const { client } = await registerUser("reportflow");
    const up = await uploadFile(client, { data: randomData(300), name: "reported-file.bin", share: true, expiresAt: null });
    const token = up.file.share.token;
    const rep = (await new Client().post(`/api/v1/public/shares/${token}/report`, { category: "copyright", description: "This is my content, taken without permission." })).body.report;

    const pending = (await admin.get("/api/v1/admin/reports?status=pending")).body.items.find((r: any) => r.id === rep.id);
    expect(pending).toMatchObject({ category: "copyright", status: "open", fileName: "reported-file.bin", fileStatus: "available" });
    expect((await admin.post(`/api/v1/admin/reports/${rep.id}`, { status: "reviewing" })).status).toBe(200);
    expect((await admin.get("/api/v1/admin/reports?status=pending")).body.items.find((r: any) => r.id === rep.id).status).toBe("reviewing");

    const resolved = await admin.post(`/api/v1/admin/reports/${rep.id}`, { status: "actioned", action: "delete", note: "Removed after review" });
    expect(resolved.status).toBe(200);
    expect((await client.get(`/api/v1/files/${up.file.id}`)).status).toBe(404);
    expect((await new Client().get(`/dl/${token}`)).status).toBe(404);
    const done = (await admin.get("/api/v1/admin/reports?status=actioned")).body.items.find((r: any) => r.id === rep.id);
    expect(done).toMatchObject({ status: "actioned", resolutionNote: "Removed after review", fileName: "reported-file.bin", fileId: null, fileStatus: "deleted" });
    expect((await admin.get("/api/v1/admin/reports?status=pending")).body.items.some((r: any) => r.id === rep.id)).toBe(false);

    const second = await uploadFile(client, { data: randomData(100), share: true, expiresAt: null });
    const rep2 = (await new Client().post(`/api/v1/public/shares/${second.file.share.token}/report`, { category: "spam", description: "Looks like spam to me." })).body.report;
    await admin.post(`/api/v1/admin/reports/${rep2.id}`, { status: "dismissed", note: "Not a violation" });
    expect((await admin.get("/api/v1/admin/reports?status=dismissed")).body.items.some((r: any) => r.id === rep2.id)).toBe(true);
    expect((await client.get(`/api/v1/files/${second.file.id}`)).status).toBe(200); // dismissed reports leave the file alone
  });
});

describe("system settings", () => {
  it("validates settings, applies them immediately, and records the change", async () => {
    const admin = await adminClient();
    const bad = await admin.put("/api/v1/admin/settings", { webhooks: { maxAttempts: "many" } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("validation_error");
    expect((await admin.put("/api/v1/admin/settings", { files: { blockedExtensions: ["with space"] } })).status).toBe(422);
    expect((await admin.put("/api/v1/admin/settings", { uploads: { chunkSizeBytes: 5 } })).status).toBe(422);

    const before = (await admin.get("/api/v1/admin/settings")).body.settings;
    const updated = await setSettings(admin, { webhooks: { maxAttempts: 3 } });
    expect(updated.webhooks.maxAttempts).toBe(3);
    expect(updated.webhooks.timeoutMs).toBe(before.webhooks.timeoutMs); // partial updates merge
    const audit =(await admin.get("/api/v1/admin/audit?action=admin.settings_updated")).body.items;
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].actorType).toBe("admin");
    await setSettings(admin, { webhooks: { maxAttempts: before.webhooks.maxAttempts } });
  });

  it("limits how long files may be kept when the account's plan sets a maximum", async () => {
    const admin = await adminClient();
    const key = `capped${Date.now().toString(36)}`.slice(0, 20);
    const created = await admin.post("/api/v1/admin/plans", { key, name: "Capped", limits: { maxRetentionDays: 10 } });
    expect(created.status).toBe(201);
    const { client, id } = await registerUser("maxret");
    await assignPlan(admin, id, key);
    const never = await client.post("/api/v1/uploads", { fileName: "x.bin", size: 10, expiresAt: null });
    expect(never.status).toBe(422);
    const tooLong = await client.post("/api/v1/uploads", { fileName: "x.bin", size: 10, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() });
    expect(tooLong.status).toBe(422);
    expect((await client.get("/api/v1/config")).body.config.limits).toMatchObject({ allowNever: false, maxRetentionDays: 10 });
    expect((await client.post("/api/v1/uploads", { fileName: "x.bin", size: 10, expiresAt: new Date(Date.now() + 5 * 86400_000).toISOString() })).status).toBe(201);
    // Raising the plan's limit applies to the account immediately.
    expect((await admin.patch(`/api/v1/admin/plans/${key}`, { limits: { maxRetentionDays: -1 } })).status).toBe(200);
    expect((await client.post("/api/v1/uploads", { fileName: "y.bin", size: 10, expiresAt: null })).status).toBe(201);
  });

  it("keeps the audit log free of secrets while recording sensitive events", async () => {
    const admin = await adminClient();
    const { client, email, id } = await registerUser("audited");
    await new Client().post("/api/v1/auth/login", { email, password: "wrong wrong wrong" });
    await client.post("/api/v1/keys", { name: "audit key", scopes: ["files:read"] });
    await uploadFile(client, { data: randomData(100), share: true, expiresAt: null });
    await client.post("/api/v1/account/password", { currentPassword: "a perfectly good passphrase", newPassword: "changed passphrase here" });
    const log = await admin.get(`/api/v1/admin/audit?actorId=${id}&limit=100`);
    const actions = log.body.items.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["auth.register", "apikey.created", "file.uploaded", "share.created", "auth.password_changed"]));
    const everything = JSON.stringify((await admin.get("/api/v1/admin/audit?limit=200")).body);
    expect(everything).not.toContain("a perfectly good passphrase");
    expect(everything).not.toContain("changed passphrase here");
    expect(everything).not.toMatch(/cairn_[0-9A-Za-z]{20,}/);
    expect(everything).not.toMatch(/scrypt\$/);
    expect((await admin.get("/api/v1/admin/audit?action=auth.")).body.items.every((e: any) => e.action.startsWith("auth."))).toBe(true);
  });

  it("exposes storage health and job retry", async () => {
    const admin = await adminClient();
    const s = (await admin.get("/api/v1/admin/storage")).body;
    expect(s.health).toMatchObject({ provider: process.env.STORAGE_PROVIDER === "s3" ? "s3" : "local", ok: true });
    expect(Array.isArray(s.byCategory)).toBe(true);
    expect((await admin.post("/api/v1/admin/jobs/retry")).body).toHaveProperty("requeued");
    expect((await new Client().get("/api/v1/health")).body).toMatchObject({ status: "ok", database: true, storage: true });
  });
});
