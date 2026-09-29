import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { request } from "undici";
import { EMPTY_SHA256, awsEncode, signRequest, type SigV4Credentials } from "./sigv4";
import type { ByteRange, StorageHealth, StorageProvider } from "./types";

/**
 * Storage in any S3-compatible object store: AWS S3, Cloudflare R2, MinIO, Backblaze B2, Wasabi and friends.
 * Plain HTTPS with Signature Version 4, no SDK. Large files use multipart upload, so the size limit is the
 * store's, not this code's. Blobs are addressed by the same generated keys as the local provider.
 */

const KEY_RE = /^[a-z0-9][a-z0-9_\-./]{0,200}$/;
const MB = 1024 * 1024;

export interface S3Config extends SigV4Credentials {
  bucket: string;
  /** Full URL of the service. Leave out for AWS. */
  endpoint?: string;
  /** true = https://host/bucket/key, false = https://bucket.host/key. Defaults to true for custom endpoints. */
  pathStyle?: boolean;
  /** Optional folder inside the bucket, e.g. "cairn/". */
  prefix?: string;
  /** Where to spool streams whose length isn't known yet. */
  tmpDir: string;
  /** Files at or above this size are sent as multipart uploads. */
  multipartThreshold?: number;
  partSize?: number;
}

export class S3Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "S3Error";
  }
}

const xmlTag = (xml: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decodeXml(m[1]) : null;
};
const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function drain(body: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

interface Sent {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
}

export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  private readonly url: URL;
  private readonly pathStyle: boolean;
  private readonly tls: boolean;
  private readonly prefix: string;
  private readonly threshold: number;
  private readonly partSize: number;

  constructor(private readonly cfg: S3Config) {
    if (!cfg.bucket) throw new Error("S3 storage needs a bucket name.");
    this.url = new URL(cfg.endpoint || `https://s3.${cfg.region}.amazonaws.com`);
    this.pathStyle = cfg.pathStyle ?? !!cfg.endpoint;
    this.tls = this.url.protocol === "https:";
    this.prefix = (cfg.prefix ?? "").replace(/^\/+/, "");
    if (this.prefix && !this.prefix.endsWith("/")) this.prefix += "/";
    this.threshold = cfg.multipartThreshold ?? 64 * MB;
    this.partSize = Math.max(5 * MB, cfg.partSize ?? 32 * MB);
  }

  private objectKey(key: string): string {
    if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) throw new Error("Invalid storage key");
    return this.prefix + key;
  }

  private target(objectKey: string | null): { host: string; path: string; base: string } {
    const host = this.pathStyle ? this.url.host : `${this.cfg.bucket}.${this.url.host}`;
    const p = this.pathStyle ? `/${this.cfg.bucket}${objectKey === null ? "" : `/${objectKey}`}` : `/${objectKey ?? ""}`;
    return { host, path: p, base: `${this.url.protocol}//${host}` };
  }

  /** One signed request. `payloadHash` is UNSIGNED-PAYLOAD over TLS and the real digest over plain HTTP. */
  private async send(method: string, objectKey: string | null, opts: { query?: Record<string, string>; headers?: Record<string, string>; body?: Readable | Buffer; payloadHash?: string; length?: number } = {}): Promise<Sent> {
    const t = this.target(objectKey);
    const headers = signRequest(this.cfg, { method, host: t.host, path: t.path, query: opts.query, headers: opts.headers, payloadHash: opts.payloadHash ?? EMPTY_SHA256 });
    if (opts.length !== undefined) headers["content-length"] = String(opts.length);
    const qs = opts.query && Object.keys(opts.query).length ? `?${Object.keys(opts.query).sort().map((k) => `${awsEncode(k, false)}=${awsEncode(opts.query![k], false)}`).join("&")}` : "";
    const res = await request(`${t.base}${awsEncode(t.path, true)}${qs}`, { method: method as "GET", headers, body: opts.body, headersTimeout: 60_000, bodyTimeout: 0 });
    return { status: res.statusCode, headers: res.headers, body: res.body as unknown as Readable };
  }

  private async fail(res: Sent, what: string): Promise<never> {
    const text = await drain(res.body).catch(() => "");
    const code = xmlTag(text, "Code") ?? undefined;
    throw new S3Error(`${what} failed (${res.status}${code ? ` ${code}` : ""})${xmlTag(text, "Message") ? `: ${xmlTag(text, "Message")}` : ""}`, res.status, code);
  }

  /** Retries transient failures (network errors, 5xx, 429) of a whole operation. */
  private async retrying<T>(fn: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await fn();
      } catch (err) {
        last = err;
        const transient = !(err instanceof S3Error) || err.status >= 500 || err.status === 429;
        if (!transient || attempt === 3) break;
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
    throw last;
  }

  private async hashFile(file: string, start = 0, end?: number): Promise<string> {
    const h = createHash("sha256");
    await pipeline(fs.createReadStream(file, { start, end }), h);
    return h.digest("hex");
  }

  private async payloadHashFor(file: string, start?: number, end?: number): Promise<string> {
    return this.tls ? "UNSIGNED-PAYLOAD" : this.hashFile(file, start, end);
  }

  // ---- writes ----------------------------------------------------------------------------------

  private async uploadFile(key: string, sourcePath: string): Promise<void> {
    const objectKey = this.objectKey(key);
    const size = (await fsp.stat(sourcePath)).size;
    if (size < this.threshold) {
      await this.retrying(async () => {
        const res = await this.send("PUT", objectKey, { body: fs.createReadStream(sourcePath), length: size, payloadHash: await this.payloadHashFor(sourcePath) });
        if (res.status !== 200) await this.fail(res, "Upload");
        await drain(res.body);
      });
      return;
    }
    await this.multipartUpload(objectKey, sourcePath, size);
  }

  private async multipartUpload(objectKey: string, file: string, size: number): Promise<void> {
    const partSize = Math.max(this.partSize, Math.ceil(size / 9000));
    const init = await this.retrying(async () => {
      const res = await this.send("POST", objectKey, { query: { uploads: "" } });
      if (res.status !== 200) await this.fail(res, "Starting a multipart upload");
      return await drain(res.body);
    });
    const uploadId = xmlTag(init, "UploadId");
    if (!uploadId) throw new S3Error("The store did not return an upload id.", 500);
    const parts: Array<{ n: number; etag: string }> = [];
    try {
      for (let start = 0, n = 1; start < size; start += partSize, n++) {
        const end = Math.min(size, start + partSize) - 1;
        const etag = await this.retrying(async () => {
          const res = await this.send("PUT", objectKey, {
            query: { partNumber: String(n), uploadId },
            body: fs.createReadStream(file, { start, end }),
            length: end - start + 1,
            payloadHash: await this.payloadHashFor(file, start, end),
          });
          if (res.status !== 200) await this.fail(res, `Uploading part ${n}`);
          await drain(res.body);
          return String(res.headers.etag ?? "");
        });
        parts.push({ n, etag });
      }
      const xml = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
      const body = Buffer.from(xml);
      await this.retrying(async () => {
        const res = await this.send("POST", objectKey, { query: { uploadId }, body, length: body.length, payloadHash: createHash("sha256").update(body).digest("hex") });
        const text = await drain(res.body);
        // S3 can answer 200 and still carry an <Error> in the body.
        if (res.status !== 200 || text.includes("<Error>")) throw new S3Error(`Completing the multipart upload failed: ${xmlTag(text, "Message") ?? res.status}`, res.status === 200 ? 500 : res.status, xmlTag(text, "Code") ?? undefined);
      });
    } catch (err) {
      await this.send("DELETE", objectKey, { query: { uploadId } }).then((r) => drain(r.body), () => undefined);
      throw err;
    }
  }

  async putFile(key: string, sourcePath: string): Promise<void> {
    await this.uploadFile(key, sourcePath);
    await fsp.unlink(sourcePath).catch(() => undefined);
  }

  async putStream(key: string, stream: Readable): Promise<{ size: number }> {
    // S3 wants the length up front, so spool to disk first (uploads are already staged on disk the same way).
    await fsp.mkdir(this.cfg.tmpDir, { recursive: true });
    const tmp = path.join(this.cfg.tmpDir, `s3-${randomBytes(8).toString("hex")}.part`);
    try {
      await pipeline(stream, fs.createWriteStream(tmp));
      const size = (await fsp.stat(tmp)).size;
      await this.uploadFile(key, tmp);
      return { size };
    } finally {
      await fsp.unlink(tmp).catch(() => undefined);
    }
  }

  // ---- reads -----------------------------------------------------------------------------------

  createReadStream(key: string, range?: ByteRange): Readable {
    const out = new PassThrough();
    let objectKey: string;
    try {
      objectKey = this.objectKey(key);
    } catch (err) {
      queueMicrotask(() => out.destroy(err as Error));
      return out;
    }
    (async () => {
      const res = await this.send("GET", objectKey, { headers: range ? { range: `bytes=${range.start}-${range.end}` } : undefined });
      if (res.status === 404) {
        await drain(res.body).catch(() => undefined);
        throw Object.assign(new Error("Not found"), { code: "ENOENT" });
      }
      if (res.status !== 200 && res.status !== 206) await this.fail(res, "Download");
      res.body.on("error", (e) => out.destroy(e));
      res.body.pipe(out);
      out.on("close", () => res.body.destroy());
    })().catch((err) => out.destroy(err as Error));
    return out;
  }

  async stat(key: string): Promise<{ size: number } | null> {
    return this.retrying(async () => {
      const res = await this.send("HEAD", this.objectKey(key));
      await drain(res.body).catch(() => undefined);
      if (res.status === 404) return null;
      if (res.status !== 200) throw new S3Error(`Looking up a file failed (${res.status})`, res.status);
      return { size: Number(res.headers["content-length"] ?? 0) };
    });
  }

  async delete(key: string): Promise<void> {
    await this.retrying(async () => {
      const res = await this.send("DELETE", this.objectKey(key));
      if (res.status !== 204 && res.status !== 200 && res.status !== 404) await this.fail(res, "Delete");
      await drain(res.body).catch(() => undefined);
    });
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const source = this.objectKey(fromKey);
    const dest = this.objectKey(toKey);
    const head = await this.stat(fromKey);
    if (!head) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
    const copySource = `/${this.cfg.bucket}/${awsEncode(source, true)}`;
    if (head.size < 4 * 1024 * MB) {
      await this.retrying(async () => {
        const res = await this.send("PUT", dest, { headers: { "x-amz-copy-source": copySource } });
        const text = await drain(res.body);
        if (res.status !== 200 || text.includes("<Error>")) throw new S3Error(`Copy failed (${res.status})${xmlTag(text, "Message") ? `: ${xmlTag(text, "Message")}` : ""}`, res.status === 200 ? 500 : res.status, xmlTag(text, "Code") ?? undefined);
      });
      return;
    }
    // Objects over 5 GB can only be copied part by part.
    const init = await this.send("POST", dest, { query: { uploads: "" } });
    if (init.status !== 200) await this.fail(init, "Starting a multipart copy");
    const uploadId = xmlTag(await drain(init.body), "UploadId")!;
    const parts: Array<{ n: number; etag: string }> = [];
    try {
      const partSize = 512 * MB;
      for (let start = 0, n = 1; start < head.size; start += partSize, n++) {
        const end = Math.min(head.size, start + partSize) - 1;
        const res = await this.send("PUT", dest, { query: { partNumber: String(n), uploadId }, headers: { "x-amz-copy-source": copySource, "x-amz-copy-source-range": `bytes=${start}-${end}` } });
        const text = await drain(res.body);
        if (res.status !== 200) throw new S3Error(`Copying part ${n} failed (${res.status})`, res.status);
        parts.push({ n, etag: xmlTag(text, "ETag") ?? "" });
      }
      const body = Buffer.from(`<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag}</ETag></Part>`).join("")}</CompleteMultipartUpload>`);
      const res = await this.send("POST", dest, { query: { uploadId }, body, length: body.length, payloadHash: createHash("sha256").update(body).digest("hex") });
      const text = await drain(res.body);
      if (res.status !== 200 || text.includes("<Error>")) throw new S3Error(`Completing the multipart copy failed (${res.status})`, res.status);
    } catch (err) {
      await this.send("DELETE", dest, { query: { uploadId } }).then((r) => drain(r.body), () => undefined);
      throw err;
    }
  }

  async *walk(): AsyncGenerator<{ key: string; size: number; mtimeMs: number }> {
    let token: string | undefined;
    do {
      const query: Record<string, string> = { "list-type": "2", "max-keys": "1000" };
      if (this.prefix) query.prefix = this.prefix;
      if (token) query["continuation-token"] = token;
      const xml = await this.retrying(async () => {
        const res = await this.send("GET", null, { query });
        if (res.status !== 200) await this.fail(res, "Listing files");
        return drain(res.body);
      });
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = xmlTag(m[1], "Key");
        if (!key) continue;
        const local = key.slice(this.prefix.length);
        if (!KEY_RE.test(local)) continue; // not one of ours
        yield { key: local, size: Number(xmlTag(m[1], "Size") ?? 0), mtimeMs: Date.parse(xmlTag(m[1], "LastModified") ?? "") || 0 };
      }
      token = xmlTag(xml, "IsTruncated") === "true" ? (xmlTag(xml, "NextContinuationToken") ?? undefined) : undefined;
    } while (token);
  }

  async health(): Promise<StorageHealth> {
    try {
      const res = await this.send("GET", null, { query: { "list-type": "2", "max-keys": "1", ...(this.prefix ? { prefix: this.prefix } : {}) } });
      if (res.status !== 200) await this.fail(res, "Reaching the bucket");
      await drain(res.body);
      return { provider: this.name, ok: true, totalBytes: null, freeBytes: null, detail: `${this.url.host} / ${this.cfg.bucket}` };
    } catch (err) {
      return { provider: this.name, ok: false, totalBytes: null, freeBytes: null, detail: (err as Error).message };
    }
  }
}

/** Builds the provider from environment variables, or explains what is missing. */
export function s3FromEnv(env: Record<string, string | undefined>, tmpDir: string): S3StorageProvider {
  const missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`STORAGE_PROVIDER=s3 needs ${missing.join(", ")}.`);
  return new S3StorageProvider({
    bucket: env.S3_BUCKET!,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    region: env.S3_REGION || "us-east-1",
    endpoint: env.S3_ENDPOINT || undefined,
    pathStyle: env.S3_FORCE_PATH_STYLE === undefined ? undefined : env.S3_FORCE_PATH_STYLE !== "false",
    prefix: env.S3_KEY_PREFIX || undefined,
    tmpDir,
  });
}
