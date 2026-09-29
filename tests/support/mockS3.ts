import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { signRequest } from "@/server/storage/sigv4";

/**
 * A small S3 look-alike for tests. It authenticates every request the way S3 does (recomputing the SigV4
 * signature from what actually arrived, and checking the payload hash), so a mistake in the signer or in
 * the provider fails loudly instead of being accepted by a forgiving fake. Objects live in memory.
 */

export const CREDS = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
interface Stored {
  data: Buffer;
  mtime: number;
}

export function startMockS3(bucket: string, pageSize = 2, port = 0) {
  const objects = new Map<string, Stored>();
  const uploads = new Map<string, Map<number, Buffer>>();
  const log: string[] = [];
  let bad: string | null = null;

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, payload: Buffer | string = "", headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-length": Buffer.byteLength(payload), ...headers });
      res.end(payload);
    };

    // Authenticate exactly like S3 would: recompute the signature from what actually arrived.
    const auth = String(req.headers.authorization ?? "");
    const m = /SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(auth);
    const claimed = String(req.headers["x-amz-content-sha256"] ?? "");
    if (!m) return send(403, "<Error><Code>AccessDenied</Code><Message>no signature</Message></Error>");
    if (claimed !== "UNSIGNED-PAYLOAD" && claimed !== sha(body)) {
      bad = `payload hash mismatch on ${req.method} ${req.url}`;
      return send(400, "<Error><Code>XAmzContentSHA256Mismatch</Code><Message>bad payload hash</Message></Error>");
    }
    const signedHeaders = m[1].split(";");
    const headers: Record<string, string> = {};
    for (const n of signedHeaders) if (n !== "host" && n !== "x-amz-content-sha256" && n !== "x-amz-date") headers[n] = String(req.headers[n]);
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (query[k] = v));
    const date = new Date(String(req.headers["x-amz-date"]).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));
    const expected = signRequest(CREDS, { method: req.method ?? "GET", host: String(req.headers.host), path: decodeURIComponent(url.pathname), query, headers, payloadHash: claimed, date });
    if (expected.authorization !== auth) {
      bad = `signature mismatch on ${req.method} ${req.url}`;
      return send(403, "<Error><Code>SignatureDoesNotMatch</Code><Message>signature</Message></Error>");
    }

    const prefix = `/${bucket}/`;
    const isBucket = url.pathname === `/${bucket}` || url.pathname === prefix;
    const key = isBucket ? null : decodeURIComponent(url.pathname.slice(prefix.length));
    log.push(`${req.method} ${key ?? "(bucket)"}${url.search}`);

    if (isBucket && req.method === "GET") {
      const all = [...objects.keys()].filter((k) => k.startsWith(url.searchParams.get("prefix") ?? "")).sort();
      const start = Number(url.searchParams.get("continuation-token") ?? 0);
      const page = all.slice(start, start + pageSize);
      const more = start + pageSize < all.length;
      const xml = `<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + pageSize}</NextContinuationToken>` : ""}${page
        .map((k) => `<Contents><Key>${k}</Key><LastModified>${new Date(objects.get(k)!.mtime).toISOString()}</LastModified><Size>${objects.get(k)!.data.length}</Size></Contents>`)
        .join("")}</ListBucketResult>`;
      return send(200, xml);
    }
    if (!key) return send(405);

    if (req.method === "POST" && "uploads" in query) {
      const id = randomBytes(6).toString("hex");
      uploads.set(id, new Map());
      return send(200, `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (req.method === "PUT" && query.uploadId && query.partNumber) {
      const u = uploads.get(query.uploadId);
      if (!u) return send(404, "<Error><Code>NoSuchUpload</Code></Error>");
      if (headers["x-amz-copy-source"]) {
        const src = objects.get(decodeURIComponent(headers["x-amz-copy-source"].slice(`/${bucket}/`.length)));
        const r = /bytes=(\d+)-(\d+)/.exec(headers["x-amz-copy-source-range"] ?? "");
        if (!src || !r) return send(404, "<Error><Code>NoSuchKey</Code></Error>");
        u.set(Number(query.partNumber), src.data.subarray(Number(r[1]), Number(r[2]) + 1));
        return send(200, `<CopyPartResult><ETag>"p${query.partNumber}"</ETag></CopyPartResult>`);
      }
      u.set(Number(query.partNumber), body);
      return send(200, "", { etag: `"p${query.partNumber}"` });
    }
    if (req.method === "POST" && query.uploadId) {
      const u = uploads.get(query.uploadId);
      if (!u) return send(404, "<Error><Code>NoSuchUpload</Code></Error>");
      const order = [...body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((x) => Number(x[1]));
      objects.set(key, { data: Buffer.concat(order.map((n) => u.get(n)!)), mtime: Date.now() });
      uploads.delete(query.uploadId);
      return send(200, "<CompleteMultipartUploadResult><Key>ok</Key></CompleteMultipartUploadResult>");
    }
    if (req.method === "DELETE" && query.uploadId) {
      uploads.delete(query.uploadId);
      return send(204);
    }
    if (req.method === "PUT" && headers["x-amz-copy-source"]) {
      const src = objects.get(decodeURIComponent(headers["x-amz-copy-source"].slice(`/${bucket}/`.length)));
      if (!src) return send(404, "<Error><Code>NoSuchKey</Code></Error>");
      objects.set(key, { data: Buffer.from(src.data), mtime: Date.now() });
      return send(200, "<CopyObjectResult><ETag>x</ETag></CopyObjectResult>");
    }
    if (req.method === "PUT") {
      if (Number(req.headers["content-length"]) !== body.length) return send(400, "<Error><Code>IncompleteBody</Code></Error>");
      objects.set(key, { data: body, mtime: Date.now() });
      return send(200, "", { etag: '"e"' });
    }
    const obj = objects.get(key);
    if (req.method === "DELETE") {
      objects.delete(key);
      return send(204);
    }
    if (!obj) return send(req.method === "HEAD" ? 404 : 404, req.method === "HEAD" ? "" : "<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>");
    if (req.method === "HEAD") return send(200, "", { "content-length": String(obj.data.length) }) as unknown as void;
    const r = /bytes=(\d+)-(\d+)/.exec(headers.range ?? "");
    if (r) return send(206, obj.data.subarray(Number(r[1]), Number(r[2]) + 1), { "content-range": `bytes ${r[1]}-${r[2]}/${obj.data.length}` });
    return send(200, obj.data);
  });

  return new Promise<{ url: string; objects: Map<string, Stored>; log: string[]; close: () => Promise<void>; problem: () => string | null }>((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        objects,
        log,
        close: () => new Promise((r) => server.close(() => r())),
        problem: () => bad,
      }),
    ),
  );
}

