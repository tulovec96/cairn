import { beforeAll, describe, expect, it } from "vitest";
import { Client, adminClient, assignPlan, randomData, registerUser, uploadFile } from "./helpers";

let admin: Client;
beforeAll(async () => {
  admin = await adminClient();
});

describe("plan entitlements are enforced on the server", () => {
  it("free accounts are refused paid features with plan_required, and pro accounts are not", async () => {
    const { client, id } = await registerUser("free");
    const up = await uploadFile(client, { data: randomData(200), share: false });

    const hook = await client.post("/api/v1/webhooks", { name: "h", url: "https://example.com/hook", events: ["*"] });
    expect(hook.status).toBe(403);
    expect(hook.body.error).toMatchObject({ code: "plan_required" });
    expect(hook.body.error.details.requiredPlan).toBeTruthy();

    const limited = await client.post("/api/v1/shares", { fileId: up.file.id, maxDownloads: 3 });
    expect(limited.status).toBe(403);
    expect(limited.body.error.code).toBe("plan_required");
    expect((await client.post("/api/v1/shares", { fileId: up.file.id, permissions: ["view"] })).status).toBe(403);
    expect((await client.post("/api/v1/shares", { fileId: up.file.id, title: "Branded" })).status).toBe(403);
    expect((await client.post("/api/v1/shares", { fileId: up.file.id, embedEnabled: true })).status).toBe(403);
    expect((await client.post("/api/v1/shares", { fileId: up.file.id })).status).toBe(201); // plain links stay free

    expect((await client.post("/api/v1/automations", { name: "a", trigger: { type: "file.uploaded" }, actions: [{ type: "archive" }] })).status).toBe(403);
    expect((await client.post("/api/v1/organizations", { name: "Team" })).status).toBe(403);
    expect((await client.post("/api/v1/imports", { url: "https://example.com/x.bin" })).status).toBe(403);
    expect((await client.post("/api/v1/requests", { name: "Portal", kind: "portal" })).status).toBe(403);
    expect((await client.post("/api/v1/requests", { name: "Docs" })).status).toBe(201);
    const second = await client.post("/api/v1/requests", { name: "More docs" });
    expect(second.status).toBe(403);
    expect(second.body.error.code).toBe("plan_limit_reached");

    await assignPlan(admin, id, "pro");
    expect((await client.post("/api/v1/webhooks", { name: "h", url: "https://example.com/hook", events: ["*"] })).status).toBe(201);
    expect((await client.post("/api/v1/shares", { fileId: up.file.id, maxDownloads: 3, permissions: ["view", "download"] })).status).toBe(201);
    expect((await client.post("/api/v1/automations", { name: "a", trigger: { type: "file.uploaded" }, actions: [{ type: "archive" }] })).status).toBe(201);
    expect((await client.post("/api/v1/requests", { name: "Portal", kind: "portal" })).status).toBe(201);
  });

  it("limits the number of API keys per plan", async () => {
    const { client } = await registerUser("keylimit");
    expect((await client.post("/api/v1/keys", { name: "one", scopes: ["files:read"] })).status).toBe(201);
    expect((await client.post("/api/v1/keys", { name: "two", scopes: ["files:read"] })).status).toBe(201);
    const third = await client.post("/api/v1/keys", { name: "three", scopes: ["files:read"] });
    expect(third.status).toBe(403);
    expect(third.body.error.code).toBe("plan_limit_reached");
  });

  it("applies plan-based API rate limits to API keys", async () => {
    const { client, id } = await registerUser("rate");
    const key = (await client.post("/api/v1/keys", { name: "rl", scopes: ["files:read"] })).body.key;
    const api = new Client();
    api.bearer = key;
    const planKey = `slow${Date.now().toString(36)}`.slice(0, 20);
    expect((await admin.post("/api/v1/admin/plans", { key: planKey, name: "Slow", limits: { apiRequestsPerMinute: 5, apiKeys: 5 } })).status).toBe(201);
    await assignPlan(admin, id, planKey);
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await api.get("/api/v1/files", { origin: null })).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(5).every((s) => s === 429)).toBe(true);
  });

  it("records API usage per endpoint without ids", async () => {
    const { client } = await registerUser("usage");
    const key = (await client.post("/api/v1/keys", { name: "u", scopes: ["files:read", "files:upload"] })).body.key;
    const api = new Client();
    api.bearer = key;
    const up = await api.fetch("/api/v1/files?name=u.bin&share=false", { method: "POST", body: new Uint8Array(20), origin: null });
    await api.get(`/api/v1/files/${up.body.file.id}`, { origin: null });
    await new Promise((r) => setTimeout(r, 500));
    const usage = (await client.get("/api/v1/keys/usage")).body;
    expect(usage.total).toBeGreaterThanOrEqual(2);
    const endpoints = usage.endpoints.map((e: any) => e.endpoint);
    expect(endpoints).toContain("GET /api/v1/files/:id");
    expect(JSON.stringify(usage)).not.toContain(up.body.file.id);
  });

  it("refuses a downgrade that would leave the account over the new plan's storage", async () => {
    const { client, id } = await registerUser("downgrade");
    await uploadFile(client, { data: randomData(5000), share: false });
    const key = `tiny${Date.now().toString(36)}`.slice(0, 20);
    await admin.post("/api/v1/admin/plans", { key, name: "Tiny", limits: { storageBytes: 1000 } });
    const res = await admin.post("/api/v1/admin/subscriptions", { subjectType: "user", subjectId: id, planKey: key });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/more than/);
    expect((await client.get("/api/v1/auth/me")).body.plan.key).toBe("free");
  });

  it("serves pricing from the plan records", async () => {
    const before = (await new Client().get("/api/v1/plans")).body;
    expect(before.plans.map((p: any) => p.key)).toEqual(expect.arrayContaining(["free", "pro", "business"]));
    expect(before.plans.find((p: any) => p.key === "free").priceMonthlyCents).toBe(0);
    await admin.patch("/api/v1/admin/plans/pro", { priceMonthlyCents: 1234 });
    expect((await new Client().get("/api/v1/plans")).body.plans.find((p: any) => p.key === "pro").priceMonthlyCents).toBe(1234);
    await admin.patch("/api/v1/admin/plans/pro", { priceMonthlyCents: before.plans.find((p: any) => p.key === "pro").priceMonthlyCents });
  });

  it("keeps plan administration to administrators", async () => {
    const { client } = await registerUser("nonadmin");
    expect((await client.get("/api/v1/admin/plans")).status).toBe(403);
    expect((await client.post("/api/v1/admin/subscriptions", { subjectType: "user", subjectId: "usr_x", planKey: "pro" })).status).toBe(403);
    expect((await client.patch("/api/v1/admin/plans/pro", { priceMonthlyCents: 1 })).status).toBe(403);
  });
});
