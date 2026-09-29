import { describe, expect, it } from "vitest";
import { Client, PASSWORD, randomData, registerUser, sha256 } from "./helpers";

async function makeKey(session: Client, scopes: string[], extra: Record<string, unknown> = {}) {
  const res = await session.post("/api/v1/keys", { name: "test key", scopes, ...extra });
  expect(res.status).toBe(201);
  const client = new Client("api-key");
  client.bearer = res.body.key;
  return { client, key: res.body.key as string, item: res.body.item };
}

describe("API keys", () => {
  it("creates keys that are shown once and stored only as a hash", async () => {
    const { client, id } = await registerUser("keys");
    const { key, item } = await makeKey(client, ["files:read", "files:write"]);
    expect(key).toMatch(/^cairn_[0-9A-Za-z]{43}$/);
    expect(item).toMatchObject({ name: "test key", scopes: ["files:read", "files:write"], lastUsedAt: null, revokedAt: null });
    expect(item.prefix).toBe(key.slice(0, 12));
    const list = await client.get("/api/v1/keys");
    expect(list.body.items).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(key); // the secret is never returned again
    const row = await (await import("@/server/db")).db.apiKey.findFirst({ where: { userId: id } });
    expect(row!.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row!.keyHash).not.toContain(key);
  });

  it("authenticates API calls with a Bearer key and records last use", async () => {
    const { client } = await registerUser("keyuse");
    const { client: api } = await makeKey(client, ["files:read", "files:write", "shares:write", "folders:write"]);
    const data = randomData(3000);
    const up = await api.fetch("/api/v1/files?name=via-api.bin", { method: "POST", body: new Uint8Array(data), origin: null });
    expect(up.status).toBe(201);
    expect(up.body.file.share).toBeNull(); // API uploads are private unless a link is asked for
    const list = await api.get("/api/v1/files", { origin: null });
    expect(list.body.files.map((f: any) => f.name)).toEqual(["via-api.bin"]);
    const dl = await api.get(`/api/v1/files/${up.body.file.id}/download`, { origin: null });
    expect(sha256(dl.buffer)).toBe(sha256(data));
    expect((await api.post("/api/v1/folders", { name: "From API" }, { origin: null })).status).toBe(201);
    const keys = await client.get("/api/v1/keys");
    expect(keys.body.items[0].lastUsedAt).toBeTruthy();
  });

  it("enforces scopes", async () => {
    const { client } = await registerUser("scopes");
    const seed = await client.post("/api/v1/folders", { name: "seed" });
    const { client: readOnly } = await makeKey(client, ["files:read"]);
    expect((await readOnly.get("/api/v1/files", { origin: null })).status).toBe(200);
    for (const attempt of [
      () => readOnly.fetch("/api/v1/files?name=x.bin", { method: "POST", body: new Uint8Array(10), origin: null }),
      () => readOnly.post("/api/v1/uploads", { fileName: "x.bin", size: 10 }, { origin: null }),
      () => readOnly.post("/api/v1/folders", { name: "nope" }, { origin: null }),
      () => readOnly.del(`/api/v1/folders/${seed.body.folder.id}`, { origin: null }),
      () => readOnly.post("/api/v1/shares", { fileId: "fil_abcdefghijklmnop" }, { origin: null }),
      () => readOnly.post("/api/v1/bulk", { action: "delete", fileIds: [], folderIds: [] }, { origin: null }),
    ]) {
      const res = await attempt();
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("forbidden");
      expect(res.body.error.message).toMatch(/scope/);
    }
    const { client: writeOnly } = await makeKey(client, ["files:write"]);
    expect((await writeOnly.get("/api/v1/files", { origin: null })).status).toBe(403);
  });

  it("keeps credential management out of reach of API keys", async () => {
    const { client, email } = await registerUser("keyguard");
    const { client: api } = await makeKey(client, ["files:read", "files:write", "shares:write", "folders:write"]);
    expect((await api.post("/api/v1/keys", { name: "escalate", scopes: ["files:read"] }, { origin: null })).status).toBe(403);
    expect((await api.get("/api/v1/keys", { origin: null })).status).toBe(403);
    expect((await api.get("/api/v1/account/sessions", { origin: null })).status).toBe(403);
    expect((await api.post("/api/v1/account/password", { currentPassword: PASSWORD, newPassword: "a new passphrase here" }, { origin: null })).status).toBe(403);
    expect((await api.post("/api/v1/account/delete", { password: PASSWORD, confirm: "DELETE" }, { origin: null })).status).toBe(403);
    expect((await new Client().post("/api/v1/auth/login", { email, password: PASSWORD })).status).toBe(200);
  });

  it("revokes keys immediately and rejects unknown, malformed or expired ones", async () => {
    const { client } = await registerUser("keyrevoke");
    const { client: api, item } = await makeKey(client, ["files:read"]);
    expect((await api.get("/api/v1/files", { origin: null })).status).toBe(200);
    expect((await client.del(`/api/v1/keys/${item.id}`)).status).toBe(204);
    const after = await api.get("/api/v1/files", { origin: null });
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("unauthorized");
    expect((await client.get("/api/v1/keys")).body.items[0].revokedAt).toBeTruthy();

    const bogus = new Client();
    bogus.bearer = "cairn_" + "x".repeat(43);
    expect((await bogus.get("/api/v1/files", { origin: null })).status).toBe(401);
    bogus.bearer = "not-a-key";
    expect((await bogus.get("/api/v1/files", { origin: null })).status).toBe(401);

    const { client: shortLived, item: shortItem } = await makeKey(client, ["files:read"], { expiresInDays: 1 });
    await (await import("@/server/db")).db.apiKey.update({ where: { id: shortItem.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await shortLived.get("/api/v1/files", { origin: null })).status).toBe(401);
  });

  it("validates key creation and limits how many keys exist", async () => {
    const { client } = await registerUser("keyvalid");
    expect((await client.post("/api/v1/keys", { name: "", scopes: ["files:read"] })).status).toBe(422);
    expect((await client.post("/api/v1/keys", { name: "x", scopes: [] })).status).toBe(422);
    expect((await client.post("/api/v1/keys", { name: "x", scopes: ["admin:everything"] })).status).toBe(422);
    expect((await new Client().post("/api/v1/keys", { name: "x", scopes: ["files:read"] })).status).toBe(401);
  });
});
