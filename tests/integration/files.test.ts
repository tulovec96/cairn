import { beforeAll, describe, expect, it } from "vitest";
import { Client, adminClient, randomData, registerUser, sha256, uploadFile } from "./helpers";

async function seed(client: Client, name: string, opts: { data?: Buffer; folderId?: string | null } = {}) {
  const up = await uploadFile(client, { data: opts.data ?? randomData(700), name, folderId: opts.folderId ?? null, share: false, expiresAt: null });
  if (!up.file) throw new Error(`seed failed for ${name}: ${up.done?.text}`);
  return up.file as { id: string; name: string; size: number };
}

describe("folders", () => {
  it("creates nested folders, lists breadcrumbs, and rejects duplicate names", async () => {
    const { client } = await registerUser("folders");
    const a = (await client.post("/api/v1/folders", { name: "Projects" })).body.folder;
    const b = (await client.post("/api/v1/folders", { name: "2030", parentId: a.id })).body.folder;
    const c = (await client.post("/api/v1/folders", { name: "Reports", parentId: b.id })).body.folder;
    const dup = await client.post("/api/v1/folders", { name: "projects" });
    expect(dup.status).toBe(409);
    const detail = await client.get(`/api/v1/folders/${c.id}`);
    expect(detail.body.path.map((p: any) => p.name)).toEqual(["All files", "Projects", "2030", "Reports"]);
    const flat = await client.get("/api/v1/folders");
    expect(flat.body.folders.map((f: any) => f.name).sort()).toEqual(["2030", "Projects", "Reports"]);
    expect((await client.patch(`/api/v1/folders/${c.id}`, { name: "Final reports" })).body.folder.name).toBe("Final reports");
  });

  it("prevents moving a folder into itself or its own descendants", async () => {
    const { client } = await registerUser("cycle");
    const a = (await client.post("/api/v1/folders", { name: "A" })).body.folder;
    const b = (await client.post("/api/v1/folders", { name: "B", parentId: a.id })).body.folder;
    const c = (await client.post("/api/v1/folders", { name: "C", parentId: b.id })).body.folder;
    for (const target of [a.id, b.id, c.id]) {
      const res = await client.patch(`/api/v1/folders/${a.id}`, { parentId: target });
      expect(res.status, `move A into ${target}`).toBe(409);
    }
    // A legal move still works, and the cycle guard also protects bulk moves.
    expect((await client.patch(`/api/v1/folders/${c.id}`, { parentId: null })).status).toBe(200);
    const bulk = await client.post("/api/v1/bulk", { action: "move", folderIds: [a.id], fileIds: [], targetFolderId: b.id });
    expect(bulk.body.done).toBe(0);
    expect(bulk.body.failed).toHaveLength(1);
  });

  it("gives moved folders a unique name and keeps guests out of folders", async () => {
    const { client } = await registerUser("movename");
    const x = (await client.post("/api/v1/folders", { name: "Same" })).body.folder;
    const target = (await client.post("/api/v1/folders", { name: "Target" })).body.folder;
    const inner = (await client.post("/api/v1/folders", { name: "Same", parentId: target.id })).body.folder;
    void inner;
    const moved = await client.patch(`/api/v1/folders/${x.id}`, { parentId: target.id });
    expect(moved.body.folder.name).toBe("Same (1)");
    const visitor = new Client();
    expect((await visitor.post("/api/v1/folders", { name: "nope" })).status).toBe(401);
    expect((await visitor.patch(`/api/v1/folders/${x.id}`, { name: "hijack" })).status).toBe(401);
  });
});

describe("listing, search, sort and pagination", () => {
  let client: Client;
  beforeAll(async () => {
    ({ client } = await registerUser("listing"));
    await seed(client, "alpha.txt", { data: Buffer.from("a".repeat(100)) });
    await seed(client, "Bravo.png", { data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") });
    await seed(client, "charlie.txt", { data: Buffer.from("c".repeat(3000)) });
    await seed(client, "delta.zip", { data: Buffer.from("PK\u0003\u0004" + "d".repeat(200), "binary") });
  });

  it("searches by name (case-insensitive), extension and type", async () => {
    const byName = await client.get("/api/v1/files?q=RAVO");
    expect(byName.body.files.map((f: any) => f.name)).toEqual(["Bravo.png"]);
    const byExt = await client.get("/api/v1/files?q=ext:txt&sort=name");
    expect(byExt.body.files.map((f: any) => f.name)).toEqual(["alpha.txt", "charlie.txt"]);
    const byType = await client.get("/api/v1/files?type=image");
    expect(byType.body.files.map((f: any) => f.name)).toEqual(["Bravo.png"]);
    const combined = await client.get("/api/v1/files?q=type:document%20char");
    expect(combined.body.files.map((f: any) => f.name)).toEqual(["charlie.txt"]);
    const none = await client.get("/api/v1/files?q=zzzz");
    expect(none.body.files).toEqual([]);
    expect(none.body.total).toBe(0);
  });

  it("sorts by name without regard to case, and by size", async () => {
    const byName = await client.get("/api/v1/files?sort=name&order=asc");
    expect(byName.body.files.map((f: any) => f.name)).toEqual(["alpha.txt", "Bravo.png", "charlie.txt", "delta.zip"]);
    const desc = await client.get("/api/v1/files?sort=size&order=desc");
    const sizes = desc.body.files.map((f: any) => f.size);
    expect(sizes).toEqual([...sizes].sort((a: number, b: number) => b - a));
  });

  it("paginates with cursors without skipping or repeating entries", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: any = await client.get(`/api/v1/files?sort=name&limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...res.body.files.map((f: any) => f.name));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(2);
    expect(seen).toEqual(["alpha.txt", "Bravo.png", "charlie.txt", "delta.zip"]);
  });

  it("validates list parameters", async () => {
    expect((await client.get("/api/v1/files?sort=bogus")).status).toBe(422);
    expect((await client.get("/api/v1/files?limit=9999")).status).toBe(422);
    expect((await client.get("/api/v1/files?folderId=not%20an%20id!")).status).toBe(422);
  });

  it("tracks favorites, recents and downloads with real data", async () => {
    const files = (await client.get("/api/v1/files?sort=name")).body.files;
    const alpha = files[0];
    expect((await client.patch(`/api/v1/files/${alpha.id}`, { favorite: true })).body.file.favorite).toBe(true);
    const favs = await client.get("/api/v1/files?view=favorites");
    expect(favs.body.files.map((f: any) => f.name)).toEqual(["alpha.txt"]);
    expect((await client.patch(`/api/v1/files/${alpha.id}`, { favorite: false })).body.file.favorite).toBe(false);
    expect((await client.get("/api/v1/files?view=favorites")).body.files).toEqual([]);

    await client.get(`/api/v1/files/${alpha.id}/download`);
    const details = await client.get(`/api/v1/files/${alpha.id}`);
    expect(details.body.file.downloadCount).toBe(1);
    expect(details.body.file.lastDownloadAt).toBeTruthy();
    const accessed = await client.get("/api/v1/files?view=recent&by=accessed");
    expect(accessed.body.files[0].name).toBe("alpha.txt");
    const uploaded = await client.get("/api/v1/files?view=recent&by=uploaded");
    expect(uploaded.body.files[0].name).toBe("delta.zip");
    // Sharing shows up in the shared view.
    const share = await client.post("/api/v1/shares", { fileId: alpha.id });
    expect(share.status).toBe(201);
    expect((await client.get("/api/v1/files?view=shared")).body.files.map((f: any) => f.name)).toEqual(["alpha.txt"]);
    expect((await client.get("/api/v1/files?view=recent&by=shared")).body.files.map((f: any) => f.name)).toEqual(["alpha.txt"]);
  });
});

describe("renaming, moving and expiry", () => {
  it("renames files, refusing collisions and sanitizing names", async () => {
    const { client } = await registerUser("rename");
    const a = await seed(client, "one.txt");
    await seed(client, "two.txt");
    expect((await client.patch(`/api/v1/files/${a.id}`, { name: "two.txt" })).status).toBe(409);
    const ok = await client.patch(`/api/v1/files/${a.id}`, { name: "../sneaky/renamed.txt" });
    expect(ok.body.file.name).toBe("renamed.txt");
    expect((await client.patch(`/api/v1/files/${a.id}`, { name: "   " })).status).toBe(422);
    const scr = await client.patch(`/api/v1/files/${a.id}`, { name: "payload.scr" });
    expect(scr.status).toBe(415);
  });

  it("moves files between folders and suffixes colliding names", async () => {
    const { client } = await registerUser("movefile");
    const folder = (await client.post("/api/v1/folders", { name: "Box" })).body.folder;
    const root = await seed(client, "same.txt");
    await seed(client, "same.txt", { folderId: folder.id });
    const moved = await client.patch(`/api/v1/files/${root.id}`, { folderId: folder.id });
    expect(moved.body.file.name).toBe("same (1).txt");
    const inFolder = await client.get(`/api/v1/files?folderId=${folder.id}&sort=name`);
    expect(inFolder.body.files.map((f: any) => f.name)).toEqual(["same (1).txt", "same.txt"]);
    expect((await client.patch(`/api/v1/files/${root.id}`, { folderId: null })).body.file.folderId).toBeNull();
  });

  it("changes expiry within the allowed range", async () => {
    const { client } = await registerUser("expiry");
    const f = await seed(client, "e.txt");
    const soon = new Date(Date.now() + 2 * 86400_000).toISOString();
    expect((await client.patch(`/api/v1/files/${f.id}`, { expiresAt: soon })).body.file.expiresAt).toBe(soon);
    expect((await client.patch(`/api/v1/files/${f.id}`, { expiresAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(422);
    expect((await client.patch(`/api/v1/files/${f.id}`, { expiresAt: null })).body.file.expiresAt).toBeNull();
    expect((await client.patch(`/api/v1/files/${f.id}`, { expiresAt: "tomorrow" })).status).toBe(422);
  });
});

describe("trash", () => {
  it("moves files to the trash, restores them, and purges them for good", async () => {
    const { client } = await registerUser("trash");
    const f = await seed(client, "trash-me.txt", { data: randomData(1234) });
    const del = await client.del(`/api/v1/files/${f.id}`);
    expect(del.body.trashed).toBe(1);
    expect((await client.get("/api/v1/files")).body.files).toEqual([]);
    const trash = await client.get("/api/v1/trash");
    expect(trash.body.items).toHaveLength(1);
    expect(trash.body.items[0]).toMatchObject({ kind: "file", name: "trash-me.txt", size: 1234 });
    // Trashed files still count against the quota until they are purged.
    expect((await client.get("/api/v1/config")).body.config.usage.usedBytes).toBe(1234);
    expect((await client.get(`/api/v1/files/${f.id}/download`)).status).toBe(404);

    expect((await client.post(`/api/v1/files/${f.id}/restore`)).status).toBe(200);
    expect((await client.get("/api/v1/files")).body.files.map((x: any) => x.name)).toEqual(["trash-me.txt"]);
    expect((await client.get(`/api/v1/files/${f.id}/download`)).status).toBe(200);

    await client.del(`/api/v1/files/${f.id}`);
    const entry = (await client.get("/api/v1/trash")).body.items[0];
    expect((await client.del(`/api/v1/trash/${entry.id}`)).status).toBe(200);
    expect((await client.get("/api/v1/trash")).body.items).toEqual([]);
    expect((await client.get("/api/v1/config")).body.config.usage.usedBytes).toBe(0);
    expect((await client.post(`/api/v1/trash/${entry.id}`)).status).toBe(404);
  });

  it("trashes and restores whole folder trees, and empties the trash", async () => {
    const { client } = await registerUser("tree");
    const top = (await client.post("/api/v1/folders", { name: "Top" })).body.folder;
    const sub = (await client.post("/api/v1/folders", { name: "Sub", parentId: top.id })).body.folder;
    const file = await seed(client, "deep.txt", { folderId: sub.id });
    await seed(client, "outside.txt");

    const del = await client.del(`/api/v1/folders/${top.id}`);
    expect(del.body.trashed).toBe(1);
    expect((await client.get("/api/v1/folders")).body.folders).toEqual([]);
    expect((await client.get("/api/v1/files?q=deep")).body.files).toEqual([]);
    expect((await client.get(`/api/v1/files/${file.id}/download`)).status).toBe(404);
    const trash = (await client.get("/api/v1/trash")).body.items;
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ kind: "folder", name: "Top", itemCount: 3 });

    expect((await client.post(`/api/v1/trash/${trash[0].id}`)).status).toBe(200);
    expect((await client.get("/api/v1/folders")).body.folders.map((f: any) => f.name).sort()).toEqual(["Sub", "Top"]);
    expect((await client.get(`/api/v1/files?folderId=${sub.id}`)).body.files.map((f: any) => f.name)).toEqual(["deep.txt"]);

    await client.del(`/api/v1/folders/${top.id}`);
    await client.del(`/api/v1/files/${(await client.get("/api/v1/files")).body.files[0].id}`);
    const emptied = await client.del("/api/v1/trash");
    expect(emptied.body.destroyed).toBe(2);
    expect((await client.get("/api/v1/trash")).body.items).toEqual([]);
    expect((await client.get(`/api/v1/files/${file.id}`)).status).toBe(404);
  });

  it("restores a file to the top level when its folder is gone", async () => {
    const { client } = await registerUser("orphan");
    const folder = (await client.post("/api/v1/folders", { name: "Temp" })).body.folder;
    const f = await seed(client, "orphan.txt", { folderId: folder.id });
    await client.del(`/api/v1/files/${f.id}`);
    await client.del(`/api/v1/folders/${folder.id}`);
    expect((await client.post(`/api/v1/files/${f.id}/restore`)).status).toBe(200);
    const restored = await client.get(`/api/v1/files/${f.id}`);
    expect(restored.body.file.folderId).toBeNull();
  });

  it("trashed files keep counting against storage until the trash is emptied; their links stop working", async () => {
    const { client } = await registerUser("trashusage");
    const up = await uploadFile(client, { data: randomData(900), share: true });
    const token = up.file.share.token;
    const removed = await client.del(`/api/v1/files/${up.file.id}`);
    expect(removed.body.trashed).toBe(1);
    expect((await new Client().get(`/dl/${token}`)).status).toBe(410);
    expect((await client.get("/api/v1/config")).body.config.usage.usedBytes).toBe(900);
    await client.del("/api/v1/trash");
    expect((await client.get("/api/v1/config")).body.config.usage.usedBytes).toBe(0);
  });
});

describe("bulk actions", () => {
  it("moves, favorites, changes expiry and deletes many items, with undo", async () => {
    const { client } = await registerUser("bulk");
    const folder = (await client.post("/api/v1/folders", { name: "Dest" })).body.folder;
    const ids = [];
    for (const n of ["b1.txt", "b2.txt", "b3.txt"]) ids.push((await seed(client, n)).id);

    const moved = await client.post("/api/v1/bulk", { action: "move", fileIds: ids, folderIds: [], targetFolderId: folder.id });
    expect(moved.body).toMatchObject({ done: 3, failed: [] });
    expect((await client.get(`/api/v1/files?folderId=${folder.id}`)).body.files).toHaveLength(3);

    expect((await client.post("/api/v1/bulk", { action: "favorite", fileIds: ids, folderIds: [folder.id] })).body.done).toBe(4);
    expect((await client.get("/api/v1/files?view=favorites")).body.files).toHaveLength(3);
    await client.post("/api/v1/bulk", { action: "unfavorite", fileIds: ids, folderIds: [folder.id] });
    expect((await client.get("/api/v1/files?view=favorites")).body.files).toHaveLength(0);

    const exp = new Date(Date.now() + 5 * 86400_000).toISOString();
    expect((await client.post("/api/v1/bulk", { action: "expiry", fileIds: ids, expiresAt: exp })).body.done).toBe(3);
    const listed = (await client.get(`/api/v1/files?folderId=${folder.id}`)).body.files;
    expect(listed.every((f: any) => f.expiresAt === exp)).toBe(true);

    const shared = await client.post("/api/v1/bulk", { action: "share", fileIds: ids, folderIds: [folder.id], password: "bulk-pass" });
    expect(shared.body.shares).toHaveLength(4);
    expect(shared.body.shares.every((s: any) => s.hasPassword)).toBe(true);

    const removed = await client.post("/api/v1/bulk", { action: "delete", fileIds: ids.slice(0, 2), folderIds: [] });
    expect(removed.body.done).toBe(2);
    expect(removed.body.trashIds).toHaveLength(2);
    const undo = await client.post("/api/v1/bulk", { action: "restore", trashIds: removed.body.trashIds });
    expect(undo.body.done).toBe(2);
    expect((await client.get(`/api/v1/files?folderId=${folder.id}`)).body.files).toHaveLength(3);
  });

  it("reports partial failures per id and ignores items that aren't yours", async () => {
    const { client } = await registerUser("bulkfail");
    const { client: other } = await registerUser("bulkother");
    const mine = await seed(client, "mine.txt");
    const theirs = await seed(other, "theirs.txt");
    const res = await client.post("/api/v1/bulk", { action: "expiry", fileIds: [mine.id, theirs.id], expiresAt: null });
    expect(res.body.done).toBe(1);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].id).toBe(theirs.id);
    const del = await client.post("/api/v1/bulk", { action: "delete", fileIds: [theirs.id], folderIds: [] });
    expect(del.body.done).toBe(0);
    expect((await other.get(`/api/v1/files/${theirs.id}`)).status).toBe(200);
    expect((await client.post("/api/v1/bulk", { action: "explode", fileIds: [] })).status).toBe(422);
  });

  it("downloads several files and folders as a ZIP built in the background", async () => {
    const { client } = await registerUser("zip");
    const folder = (await client.post("/api/v1/folders", { name: "Album" })).body.folder;
    const a = randomData(4000);
    const b = randomData(9000);
    const c = randomData(1500);
    const fa = await seed(client, "a.bin", { data: a });
    await seed(client, "b.bin", { data: b, folderId: folder.id });
    const fc = await seed(client, "c.bin", { data: c });

    const created = await client.post("/api/v1/archives", { fileIds: [fa.id, fc.id], folderIds: [folder.id] });
    expect(created.status).toBe(202);
    expect(created.body.archive.totalFiles).toBe(3);
    const ready = await waitFor(async () => {
      const s = (await client.get(`/api/v1/archives/${created.body.archive.id}`)).body.archive;
      return s.status === "ready" ? s : s.status === "failed" ? Promise.reject(new Error("archive failed")) : null;
    });
    expect(ready.processedFiles).toBe(3);
    const dl = await client.get(`/api/v1/archives/${ready.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/zip");
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(dl.buffer));
    expect(Object.keys(entries).sort()).toEqual(["Album/b.bin", "a.bin", "c.bin"]);
    expect(sha256(Buffer.from(entries["Album/b.bin"]))).toBe(sha256(b));
    expect(sha256(Buffer.from(entries["a.bin"]))).toBe(sha256(a));
    // Someone else can neither see nor download the archive.
    const { client: other } = await registerUser("zipother");
    expect((await other.get(`/api/v1/archives/${ready.id}`)).status).toBe(404);
    expect((await other.get(`/api/v1/archives/${ready.id}/download`)).status).toBe(404);
    // Nothing downloadable in the selection -> clear validation error.
    const empty = await other.post("/api/v1/archives", { fileIds: [fa.id], folderIds: [] });
    expect(empty.status).toBe(422);
  });
});

describe("dashboard data", () => {
  it("reports real counts", async () => {
    const { client } = await registerUser("dash");
    await client.post("/api/v1/folders", { name: "F" });
    const f = await seed(client, "d.bin", { data: randomData(2048) });
    const share = await client.post("/api/v1/shares", { fileId: f.id });
    await new Client().get(`/dl/${share.body.share.token}`);
    const dash = (await client.get("/api/v1/dashboard")).body;
    expect(dash.fileCount).toBe(1);
    expect(dash.folderCount).toBe(1);
    expect(dash.downloadCount).toBe(1);
    expect(dash.activeShares).toBe(1);
    expect(dash.usage.usedBytes).toBe(2048);
    expect(dash.recentFiles[0].name).toBe("d.bin");
    expect(dash.activity.map((a: any) => a.action)).toContain("uploaded");
    void adminClient;
  });
});

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 300));
  }
}
