import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3StorageProvider, s3FromEnv } from "@/server/storage/s3";
import { EMPTY_SHA256, awsEncode, canonicalQuery, signRequest } from "@/server/storage/sigv4";
import { CREDS, startMockS3 } from "../support/mockS3";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

describe("SigV4 signer (AWS documentation examples)", () => {
  it("GET Object with a Range header", () => {
    const h = signRequest(CREDS, {
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: { range: "bytes=0-9" },
      payloadHash: EMPTY_SHA256,
      date: new Date("2013-05-24T00:00:00Z"),
    });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("PUT Object with a special character in the key and extra signed headers", () => {
    const h = signRequest(CREDS, {
      method: "PUT",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test$file.text",
      headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      payloadHash: sha("Welcome to Amazon S3."),
      date: new Date("2013-05-24T00:00:00Z"),
    });
    expect(h.authorization).toContain("SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class");
    expect(h.authorization).toContain("Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  it("GET Bucket (List Objects) with a query string", () => {
    const h = signRequest(CREDS, {
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/",
      query: { "max-keys": "2", prefix: "J" },
      payloadHash: EMPTY_SHA256,
      date: new Date("2013-05-24T00:00:00Z"),
    });
    expect(h.authorization).toContain("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });

  it("encodes like AWS wants", () => {
    expect(awsEncode("a b/c$d~e", true)).toBe("a%20b/c%24d~e");
    expect(awsEncode("a/b", false)).toBe("a%2Fb");
    expect(awsEncode("é", true)).toBe("%C3%A9");
    expect(canonicalQuery({ b: "2", a: "1 2", uploads: "" })).toBe("a=1%202&b=2&uploads=");
  });
});

describe("S3StorageProvider", () => {
  let mock: Awaited<ReturnType<typeof startMockS3>>;
  let tmp: string;
  let s3: S3StorageProvider;

  beforeAll(async () => {
    mock = await startMockS3("bkt");
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "cairn-s3-"));
    s3 = new S3StorageProvider({ ...CREDS, bucket: "bkt", endpoint: mock.url, prefix: "cairn", tmpDir: tmp, multipartThreshold: 6 * 1024 * 1024, partSize: 5 * 1024 * 1024 });
  });
  afterAll(async () => {
    await mock.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  const read = async (key: string, range?: { start: number; end: number }) => {
    const chunks: Buffer[] = [];
    for await (const c of s3.createReadStream(key, range)) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  };

  it("stores and reads a small file; every request is correctly signed", async () => {
    const data = randomBytes(1000);
    const src = path.join(tmp, "small.bin");
    await fsp.writeFile(src, data);
    await s3.putFile("ab/cd/small.bin", src);
    expect(fs.existsSync(src)).toBe(false); // consumed, like the local provider
    expect(mock.objects.has("cairn/ab/cd/small.bin")).toBe(true); // prefix applied
    expect(await read("ab/cd/small.bin")).toEqual(data);
    expect(await s3.stat("ab/cd/small.bin")).toEqual({ size: 1000 });
    expect(mock.problem()).toBeNull();
  });

  it("serves byte ranges", async () => {
    const data = randomBytes(500);
    await s3.putStream("range.bin", Readable.from([data]));
    expect(await read("range.bin", { start: 10, end: 19 })).toEqual(data.subarray(10, 20));
    expect(await read("range.bin", { start: 490, end: 499 })).toEqual(data.subarray(490, 500));
  });

  it("putStream reports the size and leaves no spool files behind", async () => {
    const r = await s3.putStream("stream.bin", Readable.from([Buffer.alloc(1234, 7)]));
    expect(r.size).toBe(1234);
    expect((await fsp.readdir(tmp)).filter((f) => f.startsWith("s3-"))).toEqual([]);
  });

  it("reports missing objects the way the local provider does", async () => {
    expect(await s3.stat("nope.bin")).toBeNull();
    await expect(read("nope.bin")).rejects.toMatchObject({ code: "ENOENT" });
    await s3.delete("nope.bin"); // deleting nothing is fine
  });

  it("deletes", async () => {
    await s3.putStream("gone.bin", Readable.from([Buffer.from("x")]));
    await s3.delete("gone.bin");
    expect(await s3.stat("gone.bin")).toBeNull();
  });

  it("copies server-side without moving data through the app", async () => {
    const data = randomBytes(300);
    await s3.putStream("orig.bin", Readable.from([data]));
    mock.log.length = 0;
    await s3.copy("orig.bin", "dup/copy.bin");
    expect(await read("dup/copy.bin")).toEqual(data);
    expect(mock.log.some((l) => l.startsWith("GET dup"))).toBe(false);
    await expect(s3.copy("missing.bin", "x.bin")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uploads large files as multipart and the parts reassemble correctly", async () => {
    const data = randomBytes(11 * 1024 * 1024 + 123);
    const src = path.join(tmp, "big.bin");
    await fsp.writeFile(src, data);
    mock.log.length = 0;
    await s3.putFile("big/file.bin", src);
    expect(mock.log.filter((l) => l.includes("partNumber=")).length).toBeGreaterThanOrEqual(3);
    expect(mock.objects.get("cairn/big/file.bin")!.data.equals(data)).toBe(true);
    expect(mock.problem()).toBeNull();
  }, 30_000);

  it("lists everything across pages and strips the prefix", async () => {
    const keys: string[] = [];
    for await (const o of s3.walk()) keys.push(o.key);
    expect(keys.length).toBeGreaterThan(3); // the mock pages by 2, so this crosses several pages
    expect(keys).toContain("ab/cd/small.bin");
    expect(keys.every((k) => !k.startsWith("cairn/"))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("refuses keys that could escape or confuse the store", async () => {
    await expect(s3.stat("../x")).rejects.toThrow("Invalid storage key");
    await expect(s3.stat("A/Upper")).rejects.toThrow("Invalid storage key");
    await expect(s3.stat("a//b")).rejects.toThrow("Invalid storage key");
    await expect(read("../etc/passwd")).rejects.toThrow("Invalid storage key");
  });

  it("reports health", async () => {
    const h = await s3.health();
    expect(h).toMatchObject({ provider: "s3", ok: true });
    const wrong = new S3StorageProvider({ ...CREDS, secretAccessKey: "wrong", bucket: "bkt", endpoint: mock.url, tmpDir: tmp });
    // Same signing scheme but a different secret: the mock, like S3, rejects it.
    expect((await wrong.health()).ok).toBe(false);
  });

  it("is configured from environment variables and says what's missing", () => {
    expect(() => s3FromEnv({}, tmp)).toThrow(/S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/);
    const p = s3FromEnv({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", S3_ENDPOINT: mock.url }, tmp);
    expect(p.name).toBe("s3");
  });
});
