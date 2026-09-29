import { beforeAll, describe, expect, it } from "vitest";
import { Client, adminClient, assignPlan, randomData, registerUser, sha256, uploadFile, waitFor } from "./helpers";

let admin: Client;
beforeAll(async () => {
  admin = await adminClient();
});

const CHUNK = 256 * 1024;

async function pro(label: string) {
  const u = await registerUser(label);
  await assignPlan(admin, u.id, "pro");
  return u;
}

/** Uploads through a file request the way an outside contributor's browser does: no account, only the upload key. */
async function contribute(token: string, data: Buffer, name: string, label = "Sam") {
  const visitor = new Client("contributor");
  const init = await visitor.post(`/api/v1/public/requests/${token}/uploads`, { fileName: name, size: data.length, uploaderLabel: label });
  if (init.status !== 201) return { visitor, init, done: init };
  const up = init.body.upload;
  const headers = { "x-upload-key": up.uploadKey };
  for (let i = 0; i < up.totalChunks; i++) {
    const slice = data.subarray(i * up.chunkSize, Math.min((i + 1) * up.chunkSize, data.length));
    const res = await visitor.fetch(`/api/v1/public/uploads/${up.id}/chunks/${i}`, { method: "PUT", body: new Uint8Array(slice), headers: { ...headers, "x-chunk-sha256": sha256(slice) } });
    expect(res.status).toBe(200);
  }
  const done = await visitor.fetch(`/api/v1/public/uploads/${up.id}/complete?wait=30`, { method: "POST", json: { sha256: sha256(data) }, headers });
  return { visitor, init, done, up, headers };
}

describe("file requests and portals", () => {
  it("collects files from people without accounts and creates no session for them", async () => {
    const { client } = await pro("req1");
    const folder = (await client.post("/api/v1/folders", { name: "Inbox" })).body.folder;
    const created = await client.post("/api/v1/requests", { name: "Send me your invoices", description: "PDFs only please", folderId: folder.id, allowedExtensions: ["pdf", "txt"], maxFiles: 2, maxFileBytes: 1024 * 1024 });
    expect(created.status).toBe(201);
    const token = created.body.request.token;
    expect(created.body.request.url).toContain(`/r/${token}`);

    const pub = (await new Client().get(`/api/v1/public/requests/${token}`)).body.request;
    expect(pub).toMatchObject({ name: "Send me your invoices", state: "open", filesLeft: 2, requiresPassword: false, allowedExtensions: ["pdf", "txt"] });
    expect(JSON.stringify(pub)).not.toMatch(/ownerId|passwordHash|usr_/);

    const data = randomData(CHUNK * 2 + 5);
    const ok = await contribute(token, data, "invoice.txt");
    expect(ok.done.status).toBe(202);
    expect(ok.visitor.cookies.size).toBe(0); // no guest account or session was created
    const inbox = await waitFor(async () => {
      const list = (await client.get(`/api/v1/files?folderId=${folder.id}`)).body.files;
      return list.length ? list : null;
    });
    expect(inbox[0]).toMatchObject({ name: "invoice.txt", size: data.length, sha256: sha256(data) });
    const dl = await client.get(`/api/v1/files/${inbox[0].id}/download`);
    expect(sha256(dl.buffer)).toBe(sha256(data));

    // Restrictions are enforced by the server, not the page.
    expect((await contribute(token, randomData(50), "photo.png")).init.status).toBe(415);
    expect((await contribute(token, randomData(2 * 1024 * 1024), "big.txt")).init.status).toBe(413);
    expect((await contribute(token, randomData(80), "second.txt")).done.status).toBe(202);
    const full = await contribute(token, randomData(80), "third.txt");
    expect(full.init.status).toBe(410);
    expect((await client.get("/api/v1/requests")).body.items[0]).toMatchObject({ uploadCount: 2, state: "full" });

    const notes = (await client.get("/api/v1/notifications")).body.items.map((n: any) => n.type);
    expect(notes).toContain("request_received");
    const activity = (await client.get("/api/v1/activity")).body.items;
    expect(activity.some((a: any) => a.action === "uploaded" && /Sam/.test(a.actor ?? ""))).toBe(true);
  });

  it("upload keys only work for their own upload", async () => {
    const { client } = await pro("req2");
    const token = (await client.post("/api/v1/requests", { name: "Docs" })).body.request.token;
    const a = await new Client().post(`/api/v1/public/requests/${token}/uploads`, { fileName: "a.bin", size: 100 });
    const b = await new Client().post(`/api/v1/public/requests/${token}/uploads`, { fileName: "b.bin", size: 100 });
    const stranger = new Client();
    expect((await stranger.get(`/api/v1/public/uploads/${a.body.upload.id}`, { headers: { "x-upload-key": b.body.upload.uploadKey } })).status).toBe(404);
    expect((await stranger.get(`/api/v1/public/uploads/${a.body.upload.id}`)).status).toBe(401);
    expect((await stranger.get(`/api/v1/public/uploads/${a.body.upload.id}`, { headers: { "x-upload-key": a.body.upload.uploadKey } })).status).toBe(200);
    // The key doesn't unlock the normal account API either.
    const asBearer = new Client();
    asBearer.bearer = a.body.upload.uploadKey;
    expect((await asBearer.get("/api/v1/files", { origin: null })).status).toBe(401);
    // Account uploads can't be driven with an upload key, and vice versa.
    const mine = (await client.post("/api/v1/uploads", { fileName: "m.bin", size: 10 })).body.upload;
    expect((await stranger.get(`/api/v1/public/uploads/${mine.id}`, { headers: { "x-upload-key": a.body.upload.uploadKey } })).status).toBe(404);
  });

  it("supports passwords, closing and reopening, and expiry", async () => {
    const { client } = await pro("req3");
    const req = (await client.post("/api/v1/requests", { name: "Private drop", password: "let-me-in-1" })).body.request;
    const v = new Client();
    const before = await v.post(`/api/v1/public/requests/${req.token}/uploads`, { fileName: "a.bin", size: 10 });
    expect(before.status).toBe(401);
    expect((await v.post(`/api/v1/public/requests/${req.token}/unlock`, { password: "wrong" })).status).toBe(401);
    expect((await v.post(`/api/v1/public/requests/${req.token}/unlock`, { password: "let-me-in-1" })).status).toBe(200);
    expect((await v.post(`/api/v1/public/requests/${req.token}/uploads`, { fileName: "a.bin", size: 10 })).status).toBe(201);

    expect((await client.patch(`/api/v1/requests/${req.id}`, { closed: true })).body.request.state).toBe("closed");
    expect((await v.post(`/api/v1/public/requests/${req.token}/uploads`, { fileName: "b.bin", size: 10 })).status).toBe(410);
    expect((await client.patch(`/api/v1/requests/${req.id}`, { closed: false })).body.request.state).toBe("open");
    expect((await v.post(`/api/v1/public/requests/${req.token}/uploads`, { fileName: "c.bin", size: 10 })).status).toBe(201);

    const soon = (await client.post("/api/v1/requests", { name: "Short", expiresAt: new Date(Date.now() + 120_000).toISOString() })).body.request;
    expect(soon.state).toBe("open");
    expect((await client.post("/api/v1/requests", { name: "Past", expiresAt: new Date(Date.now() - 5000).toISOString() })).status).toBe(422);
  });

  it("applies the owner's storage quota to contributed files and keeps requests private", async () => {
    const { client, id } = await pro("req4");
    await admin.patch(`/api/v1/admin/users/${id}`, { quotaBytes: 1000 });
    const token = (await client.post("/api/v1/requests", { name: "Tiny" })).body.request.token;
    const res = await contribute(token, randomData(2000), "toobig.bin");
    expect(res.init.status).toBe(507);
    const { client: other } = await pro("req4-other");
    expect((await other.get("/api/v1/requests")).body.items).toHaveLength(0);
    const rid = (await client.get("/api/v1/requests")).body.items[0].id;
    expect((await other.patch(`/api/v1/requests/${rid}`, { closed: true })).status).toBe(404);
    expect((await other.del(`/api/v1/requests/${rid}`)).status).toBe(404);
  });
});

describe("organizations", () => {
  async function business(label: string) {
    const u = await registerUser(label);
    await assignPlan(admin, u.id, "business");
    return u;
  }

  it("shares storage between members according to their roles", async () => {
    const owner = await business("org-owner");
    const org = (await owner.client.post("/api/v1/organizations", { name: "Acme Studio" })).body.organization;
    expect(org).toMatchObject({ name: "Acme Studio", role: "owner", planKey: "business", memberCount: 1 });

    const member = await registerUser("org-member");
    const viewer = await registerUser("org-viewer");
    const outsider = await registerUser("org-outsider");
    const inviteM = (await owner.client.post(`/api/v1/organizations/${org.id}/invites`, { email: member.email, role: "member" })).body;
    const inviteV = (await owner.client.post(`/api/v1/organizations/${org.id}/invites`, { email: viewer.email, role: "viewer" })).body;
    const tokenM = /invite\/([A-Za-z0-9_-]+)/.exec(inviteM.link)![1];
    const tokenV = /invite\/([A-Za-z0-9_-]+)/.exec(inviteV.link)![1];

    // An invitation is for one address only.
    expect((await outsider.client.post(`/api/v1/invites/${tokenM}`)).status).toBe(403);
    expect((await member.client.post(`/api/v1/invites/${tokenM}`)).status).toBe(200);
    expect((await viewer.client.post(`/api/v1/invites/${tokenV}`)).status).toBe(200);
    expect((await member.client.post(`/api/v1/invites/${tokenM}`)).status).toBe(410); // single use

    const ws = { headers: { "x-cairn-workspace": org.id } };
    const shared = await uploadFileIn(owner.client, org.id, randomData(700), "plan.bin");
    expect(shared.status).toBe(201);

    // Members see, add and share organization files; viewers can only read.
    const memberList = await member.client.get("/api/v1/files", ws);
    expect(memberList.body.files.map((f: any) => f.name)).toEqual(["plan.bin"]);
    expect((await member.client.get("/api/v1/files")).body.files).toEqual([]); // personal workspace is separate
    expect((await uploadFileIn(member.client, org.id, randomData(300), "member.bin")).status).toBe(201);
    expect((await viewer.client.get("/api/v1/files", ws)).body.files).toHaveLength(2);
    const denied = await viewer.client.post("/api/v1/uploads", { fileName: "v.bin", size: 10 }, ws);
    expect(denied.status).toBe(403);
    expect((await viewer.client.post("/api/v1/folders", { name: "nope" }, ws)).status).toBe(403);
    const fileId = memberList.body.files[0].id;
    expect((await viewer.client.del(`/api/v1/files/${fileId}`, ws)).status).toBe(403);
    expect((await viewer.client.post("/api/v1/shares", { fileId }, ws)).status).toBe(403);
    expect((await member.client.post("/api/v1/shares", { fileId }, ws)).status).toBe(201);
    expect((await viewer.client.post(`/api/v1/files/${fileId}/comments`, { body: "Looks good" }, ws)).status).toBe(201); // viewers may comment
    // Members can't administer the organization.
    expect((await member.client.post(`/api/v1/organizations/${org.id}/invites`, { email: outsider.email, role: "viewer" })).status).toBe(403);

    // Outsiders can't see it by any route, even by naming the workspace.
    expect((await outsider.client.get("/api/v1/files", ws)).status).toBe(403);
    expect((await outsider.client.get(`/api/v1/files/${fileId}`)).status).toBe(404);
    expect((await outsider.client.get(`/api/v1/organizations/${org.id}`)).status).toBe(404);

    // Usage is pooled on the organization, activity is shared.
    const dash = (await owner.client.get("/api/v1/dashboard", ws)).body;
    expect(dash.fileCount).toBe(2);
    expect(dash.usage.usedBytes).toBe(1000);
    expect((await owner.client.get("/api/v1/dashboard")).body.fileCount).toBe(0);
    const activity = (await owner.client.get("/api/v1/activity", ws)).body.items;
    expect(activity.some((a: any) => a.targetName === "member.bin")).toBe(true);
    const overview = (await owner.client.get("/api/v1/organizations/current/overview", ws)).body;
    expect(overview.contributors.map((c: any) => c.name).sort()).toEqual(["org-member", "org-owner"]);

    // Roles change server-side immediately; removed members lose access.
    const detail = (await owner.client.get(`/api/v1/organizations/${org.id}`)).body;
    const memberRow = detail.members.find((m: any) => m.userId === member.id);
    expect((await owner.client.patch(`/api/v1/organizations/${org.id}/members/${memberRow.id}`, { role: "viewer" })).status).toBe(200);
    expect((await member.client.post("/api/v1/uploads", { fileName: "m2.bin", size: 10 }, ws)).status).toBe(403);
    expect((await owner.client.del(`/api/v1/organizations/${org.id}/members/${memberRow.id}`)).status).toBe(204);
    expect((await member.client.get("/api/v1/files", ws)).status).toBe(403);
  });

  it("uses the organization's plan and member limits, and protects the owner", async () => {
    const owner = await business("org-limits");
    const org = (await owner.client.post("/api/v1/organizations", { name: "Limits Inc" })).body.organization;
    const planKey = `team${Date.now().toString(36)}`.slice(0, 20);
    await admin.post("/api/v1/admin/plans", { key: planKey, name: "Small team", features: { teams: true }, limits: { orgMembers: 2, storageBytes: 5000 } });
    await assignPlan(admin, org.id, planKey, "org");
    const a = await registerUser("org-lim-a");
    const b = await registerUser("org-lim-b");
    expect((await owner.client.post(`/api/v1/organizations/${org.id}/invites`, { email: a.email, role: "member" })).status).toBe(201);
    const over = await owner.client.post(`/api/v1/organizations/${org.id}/invites`, { email: b.email, role: "member" });
    expect(over.status).toBe(403);
    expect(over.body.error.code).toBe("plan_limit_reached");
    // Storage comes from the organization's plan, not the owner's.
    const big = await owner.client.post("/api/v1/uploads", { fileName: "big.bin", size: 6000 }, { headers: { "x-cairn-workspace": org.id } });
    expect(big.status).toBe(507);
    // The owner can't be removed or demoted through the member endpoints.
    const detail = (await owner.client.get(`/api/v1/organizations/${org.id}`)).body;
    const ownerRow = detail.members.find((m: any) => m.role === "owner");
    expect((await owner.client.del(`/api/v1/organizations/${org.id}/members/${ownerRow.id}`)).status).toBe(409);
    expect((await owner.client.patch(`/api/v1/organizations/${org.id}/members/${ownerRow.id}`, { role: "viewer" })).status).toBe(409);
    // Deleting needs the exact name.
    expect((await owner.client.fetch(`/api/v1/organizations/${org.id}`, { method: "DELETE", json: { confirm: "nope" } })).status).toBe(422);
    expect((await owner.client.fetch(`/api/v1/organizations/${org.id}`, { method: "DELETE", json: { confirm: "Limits Inc" } })).status).toBe(204);
  });

  it("hands organizations to another member when the owner deletes their account", async () => {
    const owner = await business("org-leaver");
    const org = (await owner.client.post("/api/v1/organizations", { name: "Legacy" })).body.organization;
    const heir = await registerUser("org-heir");
    const inv = (await owner.client.post(`/api/v1/organizations/${org.id}/invites`, { email: heir.email, role: "member" })).body;
    await heir.client.post(`/api/v1/invites/${/invite\/([A-Za-z0-9_-]+)/.exec(inv.link)![1]}`);
    await uploadFileIn(owner.client, org.id, randomData(200), "keep.bin");
    // Self-service deletion is refused while others depend on the organization...
    const refused = await owner.client.post("/api/v1/account/delete", { password: "a perfectly good passphrase", confirm: "DELETE" });
    expect(refused.status).toBe(409);
    // ...but an administrator's deletion transfers ownership and keeps the files.
    expect((await admin.del(`/api/v1/admin/users/${owner.id}`)).status).toBe(200);
    const orgs = (await heir.client.get("/api/v1/organizations")).body.items;
    expect(orgs[0]).toMatchObject({ name: "Legacy", role: "owner" });
    expect((await heir.client.get("/api/v1/files", { headers: { "x-cairn-workspace": org.id } })).body.files.map((f: any) => f.name)).toEqual(["keep.bin"]);
  });
});

async function uploadFileIn(client: Client, orgId: string, data: Buffer, name: string) {
  const res = await client.fetch(`/api/v1/files?name=${encodeURIComponent(name)}&share=false`, { method: "POST", body: new Uint8Array(data), headers: { "x-cairn-workspace": orgId } });
  return res;
}

// keep helpers referenced for readers of this file
void uploadFile;
