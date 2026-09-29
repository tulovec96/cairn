import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 for S3-compatible services (AWS S3, Cloudflare R2, MinIO, Backblaze B2, Wasabi...).
 * Header-based authentication only. Verified against the worked examples in the AWS documentation
 * (see tests/unit/s3.test.ts).
 */

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

export const EMPTY_SHA256 = sha256("");

/** RFC 3986 encoding as S3 wants it. `slash` keeps "/" for object paths, encodes it for query values. */
export function awsEncode(value: string, keepSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(ch) || (keepSlash && ch === "/")) out += ch;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${awsEncode(k, false)}=${awsEncode(params[k], false)}`)
    .join("&");
}

function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export interface SignInput {
  method: string;
  /** Host header value (with port when it isn't the default). */
  host: string;
  /** Absolute path, already the path that will be sent (not yet percent-encoded). */
  path: string;
  query?: Record<string, string>;
  /** Extra headers to send and sign (lower-case names). Must not include host, x-amz-date or x-amz-content-sha256. */
  headers?: Record<string, string>;
  payloadHash: string;
  date?: Date;
}

/** Returns every header to send, including Authorization. */
export function signRequest(creds: SigV4Credentials, input: SignInput): Record<string, string> {
  const date = input.date ?? new Date();
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const service = creds.service ?? "s3";
  const headers: Record<string, string> = { ...(input.headers ?? {}), host: input.host, "x-amz-content-sha256": input.payloadHash, "x-amz-date": stamp };

  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [input.method.toUpperCase(), awsEncode(input.path, true), canonicalQuery(input.query ?? {}), canonicalHeaders, signedHeaders, input.payloadHash].join("\n");

  const scope = `${day}/${creds.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${creds.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, creds.region), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}
