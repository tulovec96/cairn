import { createHash, randomBytes } from "node:crypto";

export const BASE = process.env.ITEST_BASE_URL ?? "http://localhost:3210";
export const ADMIN = { email: "admin@itest.test", password: "admin passphrase for integration tests" };
export const PASSWORD = "a perfectly good passphrase";

export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
export const randomData = (bytes: number) => randomBytes(bytes);

export interface Res<T = any> {
  status: number;
  headers: Headers;
  body: T;
  text: string;
  buffer: Buffer;
}

/** A tiny browser: keeps cookies, sends a same-origin `Origin` header like real browsers do. */
export const randomIp = () => `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

export class Client {
  cookies = new Map<string, string>();
  bearer: string | null = null;
  /** Each client gets its own "network address" so rate limits in one test never leak into another. */
  ip = randomIp();
  constructor(readonly label = "client") {}

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorb(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = decodeURIComponent(pair.slice(i + 1).trim());
      const maxAge = attrs.map((a) => a.trim().toLowerCase()).find((a) => a.startsWith("max-age="));
      if (value === "" || (maxAge && Number(maxAge.split("=")[1]) <= 0)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async fetch(path: string, init: (RequestInit & { json?: unknown; origin?: string | null; ip?: string }) = {}): Promise<Res> {
    const headers = new Headers(init.headers);
    if (this.bearer && !headers.has("authorization")) headers.set("authorization", `Bearer ${this.bearer}`);
    const cookie = this.cookieHeader();
    if (cookie) headers.set("cookie", cookie);
    if (init.origin !== null && !headers.has("origin")) headers.set("origin", init.origin ?? BASE);
    headers.set("x-forwarded-for", init.ip ?? this.ip);
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers.set("content-type", "application/json");
    }
    const res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, { ...init, headers, body, redirect: "manual" });
    this.absorb(res);
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = buffer.toString("utf8");
    let parsed: unknown = null;
    if ((res.headers.get("content-type") ?? "").includes("json")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return { status: res.status, headers: res.headers, body: parsed as any, text, buffer };
  }

  get = (p: string, init: Parameters<Client["fetch"]>[1] = {}) => this.fetch(p, { ...init, method: "GET" });
  post = (p: string, json?: unknown, init: Parameters<Client["fetch"]>[1] = {}) => this.fetch(p, { ...init, method: "POST", json: json ?? {} });
  patch = (p: string, json: unknown, init: Parameters<Client["fetch"]>[1] = {}) => this.fetch(p, { ...init, method: "PATCH", json });
  put = (p: string, json: unknown, init: Parameters<Client["fetch"]>[1] = {}) => this.fetch(p, { ...init, method: "PUT", json });
  del = (p: string, init: Parameters<Client["fetch"]>[1] = {}) => this.fetch(p, { ...init, method: "DELETE" });
}

let counter = 0;
export const uniqueEmail = (prefix = "user") => `${prefix}-${Date.now().toString(36)}-${++counter}@itest.test`;

export async function registerUser(label = "user", password = PASSWORD): Promise<{ client: Client; email: string; id: string }> {
  const client = new Client(label);
  const email = uniqueEmail(label);
  const res = await client.post("/api/v1/auth/register", { email, password, displayName: label });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return { client, email, id: res.body.user.id };
}

const adminCache: { client?: Client } = {};
export async function adminClient(): Promise<Client> {
  if (adminCache.client) return adminCache.client;
  const client = new Client("admin");
  let res = await client.post("/api/v1/auth/login", ADMIN);
  if (res.status === 401) {
    // Very first run against a fresh database: the first account becomes the administrator.
    res = await client.post("/api/v1/auth/register", { ...ADMIN, displayName: "Admin" });
    if (res.status !== 201) throw new Error(`could not bootstrap admin: ${res.status} ${res.text}`);
  } else if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${res.text}`);
  adminCache.client = client;
  return client;
}

export interface UploadOpts {
  name?: string;
  data: Buffer;
  folderId?: string | null;
  share?: boolean;
  password?: string;
  maxDownloads?: number;
  expiresAt?: string | null;
  clientSha?: boolean;
  chunkOrder?: "asc" | "desc" | "shuffle";
}

/** Full chunked upload through the public API. Returns the completed upload session. */
export async function uploadFile(client: Client, opts: UploadOpts) {
  const name = opts.name ?? `file-${++counter}.bin`;
  const init = await client.post("/api/v1/uploads", {
    fileName: name,
    size: opts.data.length,
    ...(opts.folderId !== undefined ? { folderId: opts.folderId } : {}),
    ...(opts.share !== undefined ? { share: opts.share } : {}),
    ...(opts.password ? { password: opts.password } : {}),
    ...(opts.maxDownloads ? { maxDownloads: opts.maxDownloads } : {}),
    ...(opts.expiresAt !== undefined ? { expiresAt: opts.expiresAt } : {}),
  });
  if (init.status !== 201) return { init, chunks: [] as Res[], done: init, upload: null as any, file: null as any };
  const up = init.body.upload;
  if (up.guestToken && !client.bearer) {
    /* the guest cookie was captured by the client already */
  }
  const order = Array.from({ length: up.totalChunks }, (_, i) => i);
  if (opts.chunkOrder === "desc") order.reverse();
  if (opts.chunkOrder === "shuffle") order.sort(() => Math.random() - 0.5);
  const chunks: Res[] = [];
  for (const i of order) chunks.push(await putChunk(client, up, opts.data, i));
  const done = await client.post(`/api/v1/uploads/${up.id}/complete?wait=60`, opts.clientSha === false ? {} : { sha256: sha256(opts.data) });
  const upload = done.body?.upload;
  return { init, chunks, done, upload, file: upload?.file };
}

export function putChunk(client: Client, up: { id: string; chunkSize: number }, data: Buffer, index: number, corrupt = false) {
  const slice = data.subarray(index * up.chunkSize, Math.min((index + 1) * up.chunkSize, data.length));
  return client.fetch(`/api/v1/uploads/${up.id}/chunks/${index}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", "x-chunk-sha256": corrupt ? "0".repeat(64) : sha256(slice) },
    body: new Uint8Array(slice),
  });
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 20_000, everyMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export async function setSettings(admin: Client, patch: Record<string, unknown>) {
  const res = await admin.put("/api/v1/admin/settings", patch);
  if (res.status !== 200) throw new Error(`settings update failed: ${res.status} ${res.text}`);
  return res.body.settings;
}

/** Per-account overrides that take precedence over the plan (administrator feature). */
export async function setUserLimits(admin: Client, userId: string, limits: { quotaBytes?: number | null; maxFileBytes?: number | null }) {
  const res = await admin.patch(`/api/v1/admin/users/${userId}`, limits);
  if (res.status !== 200) throw new Error(`user limit update failed: ${res.status} ${res.text}`);
}

/** Assign a plan to a user (administrator feature; what happens while no payment provider is configured). */
export async function assignPlan(admin: Client, subjectId: string, planKey: string, subjectType: "user" | "org" = "user") {
  const res = await admin.post("/api/v1/admin/subscriptions", { subjectType, subjectId, planKey });
  if (res.status !== 200) throw new Error(`assign plan failed: ${res.status} ${res.text}`);
}
