import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, adminClient, randomData, registerUser, setSettings, uploadFile, waitFor } from "./helpers";


let admin: Client;
beforeAll(async () => {
  admin = await adminClient();
});

/** Service code runs in this process against the same database and storage directory as the server. */
async function services() {
  const [{ db }, { storage }, maintenance, trash] = await Promise.all([
    import("@/server/db"),
    import("@/server/storage"),
    import("@/server/services/maintenance"),
    import("@/server/services/trash"),
  ]);
  return { db, storage: storage(), ...maintenance, ...trash };
}

describe("expiration and cleanup jobs", () => {
  it("deletes expired files, reclaims their storage, kills their links and notifies the owner", async () => {
    const s = await services();
    const { client, id } = await registerUser("expiring");
    const up = await uploadFile(client, { data: randomData(1500), name: "short-lived.bin", share: true, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const token = up.file.share.token;
    const row = await s.db.file.findUnique({ where: { id: up.file.id } });
    expect(await s.storage.stat(row!.storageKey)).toEqual({ size: 1500 });
    expect((await new Client().get(`/dl/${token}`)).status).toBe(200);

    await s.db.file.update({ where: { id: up.file.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    // Once past its expiry the file is unavailable immediately, even before the cleanup job runs.
    expect((await new Client().get(`/dl/${token}`)).status).toBe(410);
    expect((await client.get(`/api/v1/files/${up.file.id}/download`)).status).toBe(410);

    const removed = await s.expireFiles();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await s.storage.stat(row!.storageKey)).toBeNull();
    expect(await s.db.file.findUnique({ where: { id: up.file.id } })).toBeNull();
    expect((await new Client().get(`/dl/${token}`)).status).toBe(404);
    const notes = await s.db.notification.findMany({ where: { userId: id, type: "file_expired" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain("short-lived.bin");
    expect((await client.get("/api/v1/config")).body.config.usage.usedBytes).toBe(0);
  });

  it("purges trash after its retention period, including the blobs", async () => {
    const s = await services();
    const { client, id } = await registerUser("purging");
    const up = await uploadFile(client, { data: randomData(900), share: false, expiresAt: null });
    const blob = (await s.db.file.findUnique({ where: { id: up.file.id } }))!.storageKey;
    await client.del(`/api/v1/files/${up.file.id}`);
    expect(await s.storage.stat(blob)).not.toBeNull();
    expect(await s.purgeExpiredTrash()).toBe(0); // not due yet
    await s.db.trashItem.updateMany({ where: { ownerId: id }, data: { purgeAt: new Date(Date.now() - 1000) } });
    expect(await s.purgeExpiredTrash()).toBeGreaterThanOrEqual(1);
    expect(await s.storage.stat(blob)).toBeNull();
    expect(await s.db.file.findUnique({ where: { id: up.file.id } })).toBeNull();
    expect(await s.db.trashItem.count({ where: { ownerId: id } })).toBe(0);
  });

  it("abandons stale upload sessions and removes their staging data", async () => {
    const s = await services();
    const { client: guest } = await registerUser("abandon");
    const data = randomData(600_000);
    const init = await guest.post("/api/v1/uploads", { fileName: "abandoned.bin", size: data.length });
    const up = init.body.upload;
    const row = await s.db.upload.findUnique({ where: { id: up.id } });
    await fsp.stat(row!.stagingPath); // the staging file exists while the session is open
    await s.db.upload.update({ where: { id: up.id }, data: { sessionExpiresAt: new Date(Date.now() - 1000) } });
    await s.cleanupUploads();
    expect((await s.db.upload.findUnique({ where: { id: up.id } }))!.status).toBe("expired");
    await expect(fsp.stat(row!.stagingPath)).rejects.toThrow();
    const late = await guest.fetch(`/api/v1/uploads/${up.id}/chunks/0`, { method: "PUT", body: new Uint8Array(256 * 1024) });
    expect(late.status).toBe(409);
  });

  // Plants files directly in the local storage directory, so it only applies to the local provider (the S3 provider's walk() is covered in tests/unit/s3.test.ts).
  it.skipIf(process.env.STORAGE_PROVIDER === "s3")("garbage-collects orphaned blobs but never touches referenced ones", async () => {
    const s = await services();
    const { client } = await registerUser("gc");
    const up = await uploadFile(client, { data: randomData(400), share: false, expiresAt: null });
    const kept = (await s.db.file.findUnique({ where: { id: up.file.id } }))!.storageKey;
    const orphanKey = "ff/ee/" + "0".repeat(46);
    const orphanPath = path.join(process.env.DATA_DIR ?? "./.data-itest", "storage", orphanKey);
    await fsp.mkdir(path.dirname(orphanPath), { recursive: true });
    await fsp.writeFile(orphanPath, "orphan");
    const old = new Date(Date.now() - 3 * 86400_000);
    await fsp.utimes(orphanPath, old, old);
    const fresh = path.join(path.dirname(orphanPath), "1".repeat(46));
    await fsp.writeFile(fresh, "in flight"); // recent files may belong to an upload that is finalizing

    expect(await s.storageGc()).toBeGreaterThanOrEqual(1);
    await expect(fsp.stat(orphanPath)).rejects.toThrow();
    await fsp.stat(fresh);
    await fsp.unlink(fresh);
    expect(await s.storage.stat(kept)).not.toBeNull();
    expect((await client.get(`/api/v1/files/${up.file.id}/download`)).status).toBe(200);
  });

});

describe("thumbnails", () => {
  it("generates a WebP thumbnail for images in the background", async () => {
    const { client } = await registerUser("thumbs");
    const { default: sharp } = await import("sharp");
    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#2557e8" } }).png().toBuffer();
    const up = await uploadFile(client, { data: png, name: "tiny.png", share: false, expiresAt: null });
    expect(up.file.mime).toBe("image/png");
    const withThumb = await waitFor(async () => {
      const f = (await client.get(`/api/v1/files/${up.file.id}`)).body.file;
      return f.hasThumbnail ? f : null;
    });
    expect(withThumb.hasThumbnail).toBe(true);
    const res = await client.get(`/api/v1/files/${up.file.id}/thumbnail`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.buffer.subarray(0, 4).toString()).toBe("RIFF");
    // Non-images never get one.
    const txt = await uploadFile(client, { data: Buffer.from("plain text"), name: "note.txt", share: false, expiresAt: null });
    expect((await client.get(`/api/v1/files/${txt.file.id}/thumbnail`)).status).toBe(404);
  });
});

describe("malware scanning", () => {
  let server: net.Server;
  let port = 0;
  const seen: Array<{ bytes: number; text: string }> = [];

  beforeAll(async () => {
    // A minimal clamd: speaks the documented INSTREAM protocol and flags the EICAR test string.
    server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      let cmdDone = false;
      const payload: Buffer[] = [];
      socket.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        if (!cmdDone) {
          const zero = buf.indexOf(0);
          if (zero < 0) return;
          const cmd = buf.subarray(0, zero).toString();
          buf = buf.subarray(zero + 1);
          cmdDone = true;
          if (cmd === "zPING") return void socket.end("PONG\0");
        }
        for (;;) {
          if (buf.length < 4) return;
          const len = buf.readUInt32BE(0);
          if (len === 0) {
            const all = Buffer.concat(payload);
            seen.push({ bytes: all.length, text: all.toString("latin1").slice(0, 200) });
            const infected = all.toString("latin1").includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
            return void socket.end(infected ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
          }
          if (buf.length < 4 + len) return;
          payload.push(buf.subarray(4, 4 + len));
          buf = buf.subarray(4 + len);
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as net.AddressInfo).port;
    await setSettings(admin, { scanner: { provider: "clamav", host: "127.0.0.1", port, timeoutMs: 20_000, maxBytes: 5 * 1024 * 1024, onError: "allow" } });
  });

  afterAll(async () => {
    await setSettings(admin, { scanner: { provider: "none" } });
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("holds files until scanned, then marks clean files available and records the scan", async () => {
    const { client } = await registerUser("scanclean");
    const data = Buffer.from("a perfectly harmless document\n".repeat(50));
    const up = await uploadFile(client, { data, name: "harmless.txt", share: true, expiresAt: null });
    expect(["scanning", "available"]).toContain(up.file.status);
    const clean = await waitFor(async () => {
      const f = (await client.get(`/api/v1/files/${up.file.id}`)).body.file;
      return f.status === "available" ? f : null;
    });
    expect(clean.scanStatus).toBe("clean");
    expect(seen.some((s) => s.bytes === data.length)).toBe(true); // the scanner really received the bytes
    expect((await new Client().get(`/dl/${up.file.share.token}`)).status).toBe(200);
    const record = await (await import("@/server/db")).db.virusScan.findFirst({ where: { fileId: up.file.id } });
    expect(record).toMatchObject({ provider: "clamav", status: "clean" });
  });

  it("quarantines infected files, revokes their links and tells the owner", async () => {
    const { client, id } = await registerUser("scaninfected");
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    const up = await uploadFile(client, { data: eicar, name: "eicar.com.txt", share: true, expiresAt: null });
    const final = await waitFor(async () => {
      const f = (await client.get(`/api/v1/files/${up.file.id}`)).body.file;
      return f.status === "quarantined" ? f : null;
    });
    expect(final.scanStatus).toBe("infected");
    expect(final.quarantineNote).toContain("Eicar-Test-Signature");
    const link = await (await import("@/server/db")).db.shareLink.findFirst({ where: { fileId: up.file.id } });
    expect(link!.revokedAt).not.toBeNull();
    expect((await new Client().get(`/dl/${link!.token}`)).status).toBe(410);
    expect((await client.get(`/api/v1/files/${up.file.id}/download`)).status).toBe(403);
    const types = (await (await import("@/server/db")).db.notification.findMany({ where: { userId: id } })).map((n) => n.type);
    expect(types).toContain("malware_detected"); // a security notification: it can't be switched off
    const item = await (await import("@/server/db")).db.quarantineItem.findUnique({ where: { fileId: up.file.id } });
    expect(item).toMatchObject({ state: "pending", source: "scan" });
    // The upload page's poller sees the same outcome, so the UI can show why the file was rejected.
    const session = (await client.get(`/api/v1/uploads/${up.upload.id}`)).body.upload;
    expect(session.file.status).toBe("quarantined");
  });

  it("stores files over the scan size limit as 'not scanned' rather than pretending", async () => {
    await setSettings(admin, { scanner: { maxBytes: 1024 * 1024 } });
    const { client } = await registerUser("scanbig");
    const up = await uploadFile(client, { data: randomData(1024 * 1024 + 10), share: false, expiresAt: null });
    expect(up.file.status).toBe("available");
    expect(up.file.scanStatus).toBe("not_scanned");
    await setSettings(admin, { scanner: { maxBytes: 5 * 1024 * 1024 } });
  });
});
