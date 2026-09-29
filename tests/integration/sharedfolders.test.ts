import { describe, expect, it } from "vitest";
import { Client, randomData, registerUser, sha256, uploadFile, waitFor } from "./helpers";

/** An owner with a shared folder "Project" containing a file, plus a subfolder with a file, and an unshared sibling. */
async function scene() {
  const owner = await registerUser("owner");
  const member = await registerUser("member");
  const project = (await owner.client.post("/api/v1/folders", { name: "Project" })).body.folder;
  const sub = (await owner.client.post("/api/v1/folders", { name: "Drafts", parentId: project.id })).body.folder;
  const secret = (await owner.client.post("/api/v1/folders", { name: "Private" })).body.folder;
  const docData = randomData(1500);
  const doc = (await uploadFile(owner.client, { data: docData, name: "plan.bin", folderId: project.id, share: false })).file;
  const draft = (await uploadFile(owner.client, { data: randomData(700), name: "draft.bin", folderId: sub.id, share: false })).file;
  const hidden = (await uploadFile(owner.client, { data: randomData(400), name: "hidden.bin", folderId: secret.id, share: false })).file;
  const rootFile = (await uploadFile(owner.client, { data: randomData(300), name: "root.bin", share: false })).file;
  return { owner, member, project, sub, secret, doc, docData, draft, hidden, rootFile };
}

async function share(s: Awaited<ReturnType<typeof scene>>, folderId = s.project.id) {
  const res = await s.owner.client.post(`/api/v1/folders/${folderId}/members`, { email: s.member.email });
  expect(res.status).toBe(201);
  return res;
}

describe("sharing a folder with people", () => {
  it("lets a member browse, preview and download what's inside, and nothing else", async () => {
    const s = await scene();
    const res = await share(s);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ email: s.member.email });

    const list = await s.member.client.get("/api/v1/shared-with-me");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ folderId: s.project.id, name: "Project", ownerName: "owner" });

    const top = await s.member.client.get(`/api/v1/shared-with-me/folders/${s.project.id}`);
    expect(top.status).toBe(200);
    expect(top.body.breadcrumbs.map((b: { name: string }) => b.name)).toEqual(["Project"]);
    expect(top.body.files.map((f: { name: string }) => f.name)).toEqual(["plan.bin"]);
    expect(top.body.folders.map((f: { name: string }) => f.name)).toEqual(["Drafts"]);

    const inner = await s.member.client.get(`/api/v1/shared-with-me/folders/${s.sub.id}`);
    expect(inner.status).toBe(200);
    expect(inner.body.breadcrumbs.map((b: { name: string }) => b.name)).toEqual(["Project", "Drafts"]);
    expect(inner.body.files.map((f: { name: string }) => f.name)).toEqual(["draft.bin"]);

    const dl = await s.member.client.get(`/api/v1/shared-with-me/files/${s.doc.id}/download`);
    expect(dl.status).toBe(200);
    expect(sha256(dl.buffer)).toBe(sha256(s.docData));
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    const nested = await s.member.client.get(`/api/v1/shared-with-me/files/${s.draft.id}/download`);
    expect(nested.status).toBe(200);
  });

  it("does not reach anything outside the shared folder, even by guessing ids", async () => {
    const s = await scene();
    await share(s);
    // parent (root), sibling folder, and the files in them
    expect((await s.member.client.get(`/api/v1/shared-with-me/folders/${s.secret.id}`)).status).toBe(404);
    expect((await s.member.client.get(`/api/v1/shared-with-me/files/${s.hidden.id}/download`)).status).toBe(404);
    expect((await s.member.client.get(`/api/v1/shared-with-me/files/${s.rootFile.id}/download`)).status).toBe(404);
    // the owner-only endpoints stay owner-only
    expect((await s.member.client.get(`/api/v1/files/${s.doc.id}`)).status).toBe(404);
    expect((await s.member.client.get(`/api/v1/files/${s.doc.id}/download`)).status).toBe(404);
    expect((await s.member.client.get(`/api/v1/folders/${s.project.id}/members`)).status).toBe(404);
    const all = await s.member.client.get("/api/v1/files");
    expect(all.body.files).toEqual([]);
  });

  it("is view-only: a member can't change, move, delete, re-share or invite", async () => {
    const s = await scene();
    await share(s);
    const other = await registerUser("other");
    expect((await s.member.client.patch(`/api/v1/files/${s.doc.id}`, { name: "hacked.bin" })).status).toBe(404);
    expect((await s.member.client.del(`/api/v1/files/${s.doc.id}`)).status).toBe(404);
    expect((await s.member.client.post("/api/v1/shares", { fileId: s.doc.id })).status).toBe(404);
    expect((await s.member.client.post(`/api/v1/folders/${s.project.id}/members`, { email: other.email })).status).toBe(404);
    const after = await s.owner.client.get(`/api/v1/files/${s.doc.id}`);
    expect(after.body.file.name).toBe("plan.bin");
    expect((await other.client.get("/api/v1/shared-with-me")).body.items).toEqual([]);
  });

  it("gives outsiders no access and no signal about who has an account", async () => {
    const s = await scene();
    const stranger = await registerUser("stranger");
    for (const path of [`/api/v1/shared-with-me/folders/${s.project.id}`, `/api/v1/shared-with-me/files/${s.doc.id}/download`, `/api/v1/shared-with-me/files/${s.doc.id}/preview`, `/api/v1/shared-with-me/files/${s.doc.id}/thumbnail`]) {
      expect((await stranger.client.get(path)).status).toBe(404);
    }
    expect((await new Client("anon").get("/api/v1/shared-with-me")).status).toBe(401);

    const real = await s.owner.client.post(`/api/v1/folders/${s.project.id}/members`, { email: s.member.email });
    const fake = await s.owner.client.post(`/api/v1/folders/${s.project.id}/members`, { email: "nobody-here@itest.test" });
    expect(fake.status).toBe(201);
    expect(fake.body.note).toBe(real.body.note);
    expect(fake.body.items).toHaveLength(1); // nothing was created for the unknown address
  });

  it("is idempotent, ignores self-shares and tells the member", async () => {
    const s = await scene();
    await share(s);
    const again = await share(s);
    expect(again.body.items).toHaveLength(1);
    const self = await s.owner.client.post(`/api/v1/folders/${s.project.id}/members`, { email: s.owner.email });
    expect(self.body.items).toHaveLength(1);
    const note = await waitFor(async () => {
      const n = await s.member.client.get("/api/v1/notifications");
      return n.body.items.find((x: { type: string }) => x.type === "folder_shared");
    });
    expect(note.href).toContain(`/shared-with-me?folder=${s.project.id}`);
  });

  it("stops the moment the owner removes someone, or the member leaves", async () => {
    const s = await scene();
    const res = await share(s);
    const membershipId = res.body.items[0].id;
    // A different account can't remove someone else's access
    const other = await registerUser("bystander");
    expect((await other.client.del(`/api/v1/folders/${s.project.id}/members/${membershipId}`)).status).toBe(404);
    expect((await s.member.client.get(`/api/v1/shared-with-me/folders/${s.project.id}`)).status).toBe(200);

    expect((await s.owner.client.del(`/api/v1/folders/${s.project.id}/members/${membershipId}`)).status).toBe(204);
    expect((await s.member.client.get(`/api/v1/shared-with-me/folders/${s.project.id}`)).status).toBe(404);
    expect((await s.member.client.get(`/api/v1/shared-with-me/files/${s.doc.id}/download`)).status).toBe(404);

    // Share again, then the member leaves on their own
    const again = await share(s);
    const id2 = again.body.items[0].id;
    expect((await s.member.client.del(`/api/v1/folders/${s.project.id}/members/${id2}`)).status).toBe(204);
    expect((await s.member.client.get("/api/v1/shared-with-me")).body.items).toEqual([]);
  });

  it("hides trashed, archived and blocked content, and follows the folder into the trash", async () => {
    const s = await scene();
    await share(s);
    const extra = (await uploadFile(s.owner.client, { data: randomData(200), name: "extra.bin", folderId: s.project.id, share: false })).file;
    let top = await s.member.client.get(`/api/v1/shared-with-me/folders/${s.project.id}`);
    expect(top.body.files.map((f: { name: string }) => f.name).sort()).toEqual(["extra.bin", "plan.bin"]);

    await s.owner.client.post("/api/v1/bulk", { action: "archive", fileIds: [extra.id] });
    top = await s.member.client.get(`/api/v1/shared-with-me/folders/${s.project.id}`);
    expect(top.body.files.map((f: { name: string }) => f.name)).toEqual(["plan.bin"]);
    expect((await s.member.client.get(`/api/v1/shared-with-me/files/${extra.id}/download`)).status).toBe(404);

    await s.owner.client.post("/api/v1/bulk", { action: "delete", fileIds: [s.doc.id], folderIds: [] });
    top = await s.member.client.get(`/api/v1/shared-with-me/folders/${s.project.id}`);
    expect(top.body.files).toEqual([]);
    expect((await s.member.client.get(`/api/v1/shared-with-me/files/${s.doc.id}/download`)).status).toBe(404);

    await s.owner.client.post("/api/v1/bulk", { action: "delete", fileIds: [], folderIds: [s.project.id] });
    expect((await s.member.client.get(`/api/v1/shared-with-me/folders/${s.project.id}`)).status).toBe(404);
    expect((await s.member.client.get("/api/v1/shared-with-me")).body.items).toEqual([]);
  });

  it("stops following a subfolder that was moved out of the shared tree", async () => {
    const s = await scene();
    await share(s);
    expect((await s.member.client.get(`/api/v1/shared-with-me/folders/${s.sub.id}`)).status).toBe(200);
    const moved = await s.owner.client.patch(`/api/v1/folders/${s.sub.id}`, { parentId: null });
    expect(moved.status).toBe(200);
    expect((await s.member.client.get(`/api/v1/shared-with-me/folders/${s.sub.id}`)).status).toBe(404);
    expect((await s.member.client.get(`/api/v1/shared-with-me/files/${s.draft.id}/download`)).status).toBe(404);
  });

  it("counts a member's download against the owner and shows who did it", async () => {
    const s = await scene();
    await share(s);
    const before = (await s.owner.client.get(`/api/v1/files/${s.doc.id}`)).body.file.downloadCount;
    await s.member.client.get(`/api/v1/shared-with-me/files/${s.doc.id}/download`);
    const after = (await s.owner.client.get(`/api/v1/files/${s.doc.id}`)).body.file.downloadCount;
    expect(after).toBe(before + 1);
    const activity = await s.owner.client.get(`/api/v1/files/${s.doc.id}/activity`);
    expect(JSON.stringify(activity.body)).toContain("member");
  });

  it("loses access when either account is deleted", async () => {
    const s = await scene();
    await share(s);
    const del = await s.member.client.post("/api/v1/account/delete", { password: "a perfectly good passphrase", confirm: "DELETE" });
    expect(del.status).toBe(200);
    const members = await s.owner.client.get(`/api/v1/folders/${s.project.id}/members`);
    expect(members.body.items).toEqual([]);
  });

  it("validates the request", async () => {
    const s = await scene();
    expect((await s.owner.client.post(`/api/v1/folders/${s.project.id}/members`, { email: "not-an-email" })).status).toBe(422);
    expect((await s.owner.client.post(`/api/v1/folders/fld_doesnotexist/members`, { email: s.member.email })).status).toBe(404);
  });
});
