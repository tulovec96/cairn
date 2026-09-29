import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, adminClient, assignPlan, randomData, registerUser, setSettings, uploadFile, waitFor } from "./helpers";

let admin: Client;
let server: http.Server;
let port = 0;
const received: Array<{ headers: http.IncomingHttpHeaders; body: string; path: string }> = [];
let respondWith = 200;

beforeAll(async () => {
  admin = await adminClient();
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8"), path: req.url ?? "" });
      res.statusCode = respondWith;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await setSettings(admin, { webhooks: { allowPrivateNetworks: false } });
  server.close();
});

async function pro(label: string) {
  const u = await registerUser(label);
  await assignPlan(admin, u.id, "pro");
  return u;
}

const verify = (secret: string, headers: http.IncomingHttpHeaders, body: string) => {
  const sig = String(headers["x-cairn-signature"]);
  const t = /t=(\d+)/.exec(sig)![1];
  const v1 = /v1=([a-f0-9]+)/.exec(sig)![1];
  return { t: Number(t), ok: createHmac("sha256", secret).update(`${t}.${body}`).digest("hex") === v1 };
};

describe("webhooks", () => {
  it("refuses private network targets unless an administrator allows them (SSRF)", async () => {
    const { client } = await pro("hook-ssrf");
    await setSettings(admin, { webhooks: { allowPrivateNetworks: false } });
    for (const url of [`http://127.0.0.1:${port}/x`, "http://localhost/x", "http://169.254.169.254/latest/meta-data", "http://[::1]/x", "http://10.0.0.5/x", "ftp://example.com/x", "http://user:pw@example.com/x"]) {
      const res = await client.post("/api/v1/webhooks", { name: "bad", url, events: ["*"] });
      expect(res.status, url).toBe(422);
    }
    expect((await client.post("/api/v1/webhooks", { name: "ok", url: "https://example.com/hook", events: ["file.uploaded"] })).status).toBe(201);
  });

  it("delivers signed events, and the signature verifies with the secret shown at creation", async () => {
    await setSettings(admin, { webhooks: { allowPrivateNetworks: true, maxAttempts: 4 } });
    const { client } = await pro("hook-deliver");
    const created = await client.post("/api/v1/webhooks", { name: "local", url: `http://127.0.0.1:${port}/hook`, events: ["file.uploaded"] });
    expect(created.status).toBe(201);
    const { secret, webhook } = created.body;
    expect(secret).toMatch(/^whsec_/);
    expect(JSON.stringify((await client.get("/api/v1/webhooks")).body)).not.toContain(secret); // shown once
    const row = await (await import("@/server/db")).db.webhook.findUnique({ where: { id: webhook.id } });
    expect(row!.secretEnc).not.toContain(secret); // encrypted at rest

    received.length = 0;
    const up = await uploadFile(client, { data: randomData(321), name: "hooked.bin", share: false });
    const hit = await waitFor(async () => received.find((r) => r.path === "/hook" && r.body.includes(up.file.id)) ?? null);
    const payload = JSON.parse(hit.body);
    expect(payload).toMatchObject({ type: "file.uploaded", data: { fileId: up.file.id, name: "hooked.bin" } });
    expect(hit.headers["x-cairn-event"]).toBe("file.uploaded");
    expect(hit.headers["x-cairn-delivery"]).toMatch(/^wdl_/);
    const check = verify(secret, hit.headers, hit.body);
    expect(check.ok).toBe(true);
    expect(Math.abs(Date.now() / 1000 - check.t)).toBeLessThan(120); // timestamp is signed too, so receivers can reject replays
    expect(verify("whsec_wrong", hit.headers, hit.body).ok).toBe(false);
    expect(verify(secret, hit.headers, hit.body + " ").ok).toBe(false);

    const deliveries = (await client.get(`/api/v1/webhooks/${webhook.id}/deliveries`)).body.items;
    expect(deliveries[0]).toMatchObject({ event: "file.uploaded", status: "success", responseCode: 200 });
  });

  it("only sends subscribed events, tests, replays with a fresh signature and rotates secrets", async () => {
    await setSettings(admin, { webhooks: { allowPrivateNetworks: true } });
    const { client } = await pro("hook-more");
    const { webhook, secret } = (await client.post("/api/v1/webhooks", { name: "shares", url: `http://127.0.0.1:${port}/only-shares`, events: ["share.created"] })).body;
    received.length = 0;
    const up = await uploadFile(client, { data: randomData(50), share: false });
    await new Promise((r) => setTimeout(r, 1500));
    expect(received.filter((r) => r.path === "/only-shares")).toHaveLength(0);
    await client.post("/api/v1/shares", { fileId: up.file.id });
    const shareHit = await waitFor(async () => received.find((r) => r.path === "/only-shares") ?? null);
    expect(JSON.parse(shareHit.body).type).toBe("share.created");

    received.length = 0;
    const test = await client.post(`/api/v1/webhooks/${webhook.id}/test`);
    expect(test.body.delivery).toMatchObject({ event: "webhook.test", status: "success" });
    expect(JSON.parse(received[0].body).type).toBe("webhook.test");

    const list = (await client.get(`/api/v1/webhooks/${webhook.id}/deliveries`)).body.items;
    received.length = 0;
    await new Promise((r) => setTimeout(r, 1100)); // a different timestamp proves the signature is fresh
    const replay = await client.post(`/api/v1/webhooks/${webhook.id}/deliveries/${list[list.length - 1].id}`);
    expect(replay.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(verify(secret, received[0].headers, received[0].body).ok).toBe(true);

    const rotated = (await client.post(`/api/v1/webhooks/${webhook.id}/secret`)).body.secret;
    expect(rotated).not.toBe(secret);
    received.length = 0;
    await client.post(`/api/v1/webhooks/${webhook.id}/test`);
    expect(verify(rotated, received[0].headers, received[0].body).ok).toBe(true);
    expect(verify(secret, received[0].headers, received[0].body).ok).toBe(false);
  });

  it("retries failures, records them and isolates webhooks between accounts", async () => {
    await setSettings(admin, { webhooks: { allowPrivateNetworks: true, maxAttempts: 2 } });
    const { client } = await pro("hook-fail");
    const { webhook } = (await client.post("/api/v1/webhooks", { name: "flaky", url: `http://127.0.0.1:${port}/flaky`, events: ["file.uploaded"] })).body;
    respondWith = 500;
    received.length = 0;
    await uploadFile(client, { data: randomData(60), share: false });
    const failed = await waitFor(async () => {
      const items = (await client.get(`/api/v1/webhooks/${webhook.id}/deliveries`)).body.items;
      return items[0]?.status === "failed" ? items[0] : null;
    }, 60_000);
    respondWith = 200;
    expect(failed).toMatchObject({ responseCode: 500, attempts: 2 });
    expect(failed.error).toMatch(/500/);
    expect((await client.get(`/api/v1/webhooks/${webhook.id}/deliveries/${failed.id}`)).body.delivery.payload.type).toBe("file.uploaded");

    const { client: other } = await pro("hook-other");
    expect((await other.get("/api/v1/webhooks")).body.items).toHaveLength(0);
    expect((await other.get(`/api/v1/webhooks/${webhook.id}/deliveries`)).status).toBe(404);
    expect((await other.post(`/api/v1/webhooks/${webhook.id}/test`)).status).toBe(404);
    expect((await other.del(`/api/v1/webhooks/${webhook.id}`)).status).toBe(404);
  });
});

describe("automations", () => {
  it("runs rules in the background: tag, move and rename matching files, and records every run", async () => {
    const { client } = await pro("auto1");
    const dest = (await client.post("/api/v1/folders", { name: "PDFs" })).body.folder;
    const rule = await client.post("/api/v1/automations", {
      name: "File PDFs",
      trigger: { type: "file.uploaded" },
      conditions: [{ field: "extension", op: "is", value: "pdf" }, { field: "size", op: "lt", value: 10_000 }],
      actions: [{ type: "tag", tags: ["auto-pdf"] }, { type: "rename", pattern: "{date}-{name}.{ext}" }, { type: "move", folderId: dest.id }],
    });
    expect(rule.status).toBe(201);
    const id = rule.body.automation.id;

    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomData(200)]);
    const hit = await uploadFile(client, { data: pdf, name: "report.pdf", share: false });
    const moved = await waitFor(async () => {
      const f = (await client.get(`/api/v1/files/${hit.file.id}`)).body.file;
      return f.folderId === dest.id ? f : null;
    });
    expect(moved.tags.map((t: any) => t.name)).toEqual(["auto-pdf"]);
    expect(moved.name).toMatch(/^\d{4}-\d{2}-\d{2}-report\.pdf$/);

    const miss = await uploadFile(client, { data: randomData(100), name: "notes.txt", share: false });
    const runs = await waitFor(async () => {
      const r = (await client.get(`/api/v1/automations/${id}/runs`)).body.items;
      return r.length >= 2 ? r : null;
    });
    expect(runs.find((r: any) => r.fileId === hit.file.id)).toMatchObject({ status: "success" });
    expect(runs.find((r: any) => r.fileId === miss.file.id)).toMatchObject({ status: "skipped" });
    expect((await client.get(`/api/v1/files/${miss.file.id}`)).body.file.folderId).toBeNull();
    expect((await client.get("/api/v1/automations")).body.items[0].runCount).toBeGreaterThanOrEqual(1);
  });

  it("never triggers itself: actions performed by an automation don't start other automations", async () => {
    const { client } = await pro("auto-loop");
    const dest = (await client.post("/api/v1/folders", { name: "Loop" })).body.folder;
    const a = (await client.post("/api/v1/automations", { name: "A", trigger: { type: "file.uploaded" }, actions: [{ type: "move", folderId: dest.id }] })).body.automation;
    const b = (await client.post("/api/v1/automations", { name: "B", trigger: { type: "file.moved" }, actions: [{ type: "tag", tags: ["moved-by-b"] }] })).body.automation;
    const up = await uploadFile(client, { data: randomData(80), share: false });
    await waitFor(async () => ((await client.get(`/api/v1/automations/${a.id}/runs`)).body.items.length ? true : null));
    await new Promise((r) => setTimeout(r, 2500));
    expect((await client.get(`/api/v1/automations/${b.id}/runs`)).body.items).toHaveLength(0);
    expect((await client.get(`/api/v1/files/${up.file.id}`)).body.file.tags).toEqual([]);
    // A manual move by the user does trigger B.
    const other = (await client.post("/api/v1/folders", { name: "Manual" })).body.folder;
    await client.patch(`/api/v1/files/${up.file.id}`, { folderId: other.id });
    await waitFor(async () => (((await client.get(`/api/v1/files/${up.file.id}`)).body.file.tags.length) ? true : null));
  });

  it("validates rules, limits how many can be enabled and keeps them private", async () => {
    const { client } = await pro("auto-valid");
    expect((await client.post("/api/v1/automations", { name: "x", trigger: { type: "file.exploded" }, actions: [{ type: "archive" }] })).status).toBe(422);
    expect((await client.post("/api/v1/automations", { name: "x", trigger: { type: "file.uploaded" }, actions: [] })).status).toBe(422);
    expect((await client.post("/api/v1/automations", { name: "x", trigger: { type: "file.uploaded" }, actions: [{ type: "move", folderId: "fld_doesnotexist000" }] })).status).toBe(422);
    for (let i = 0; i < 10; i++) expect((await client.post("/api/v1/automations", { name: `r${i}`, trigger: { type: "file.uploaded" }, actions: [{ type: "archive" }] })).status).toBe(201);
    const over = await client.post("/api/v1/automations", { name: "one too many", trigger: { type: "file.uploaded" }, actions: [{ type: "archive" }] });
    expect(over.status).toBe(403);
    expect(over.body.error.code).toBe("plan_limit_reached");
    const first = (await client.get("/api/v1/automations")).body.items[0];
    expect((await client.patch(`/api/v1/automations/${first.id}`, { enabled: false })).body.automation.enabled).toBe(false);
    const { client: other } = await pro("auto-other");
    expect((await other.get(`/api/v1/automations/${first.id}/runs`)).status).toBe(404);
    expect((await other.patch(`/api/v1/automations/${first.id}`, { enabled: true })).status).toBe(404);
  });
});
