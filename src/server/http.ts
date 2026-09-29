import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import { env } from "./env";
import { ApiError, Errors } from "./errors";

export const SESSION_COOKIE = "cairn_session";
export const WORKSPACE_COOKIE = "cairn_workspace";

export interface CookieToSet {
  name: string;
  value: string;
  maxAgeSec?: number;
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
}

export function serializeCookie(c: CookieToSet): string {
  const parts = [`${c.name}=${encodeURIComponent(c.value)}`, `Path=${c.path ?? "/"}`];
  if (c.maxAgeSec !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(c.maxAgeSec))}`);
    if (c.maxAgeSec <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  }
  if (c.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${(c.sameSite ?? "lax").replace(/^./, (s) => s.toUpperCase())}`);
  if (env.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Best-effort client address, resistant to header spoofing.
 *
 * - `TRUST_PROXY=<n>`: the app sits behind n reverse proxies that each append to X-Forwarded-For, so the
 *   n-th entry from the right is the client. Earlier entries are client-controlled and ignored.
 * - Otherwise `X-Forwarded-For` is ignored entirely. The production server (server.mjs) stamps requests
 *   with the TCP peer address in `x-cairn-peer` and discards any client-supplied copy.
 * - With neither available (plain `next dev`) the address is unknown and callers fall back to actor keys.
 */
export function clientIp(req: Request): string {
  const proxies = Number.parseInt(process.env.TRUST_PROXY ?? "0", 10) || 0;
  if (proxies > 0) {
    const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[Math.max(0, parts.length - proxies)].slice(0, 64);
  }
  if (process.env.CAIRN_CUSTOM_SERVER === "1") {
    const peer = req.headers.get("x-cairn-peer");
    if (peer) return peer.replace(/^::ffff:/, "").slice(0, 64);
  }
  return "unknown";
}
export function userAgentOf(req: Request): string | null {
  const ua = req.headers.get("user-agent");
  return ua ? ua.slice(0, 300) : null;
}

/** CSRF defence for cookie-authenticated, state-changing requests. */
export function assertSameOrigin(req: Request) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (origin) {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      throw Errors.csrf();
    }
    const allowed = new Set<string>([new URL(env.appUrl).host]);
    const reqHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (reqHost) allowed.add(reqHost);
    if (!allowed.has(host)) throw Errors.csrf();
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw Errors.csrf();
}

export function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? Number(value) : value;
}

export function json(data: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(data, jsonReplacer), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init?.headers,
    },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export async function readBodyLimited(req: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw Errors.tooLarge();
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw Errors.tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export function zodDetails(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export async function parseJson<T extends ZodType>(req: Request, schema: T, maxBytes = 1024 * 1024): Promise<z.infer<T>> {
  const buf = await readBodyLimited(req, maxBytes);
  let raw: unknown;
  try {
    raw = buf.length ? JSON.parse(buf.toString("utf8")) : {};
  } catch {
    throw Errors.badRequest("The request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw Errors.validation("Some fields are invalid.", zodDetails(parsed.error));
  return parsed.data;
}

export function parseQuery<T extends ZodType>(req: Request, schema: T): z.infer<T> {
  const obj: Record<string, string> = {};
  new URL(req.url).searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  const parsed = schema.safeParse(obj);
  if (!parsed.success) throw Errors.validation("Some query parameters are invalid.", zodDetails(parsed.error));
  return parsed.data;
}

export interface Ctx<P> {
  req: NextRequest;
  params: P;
  ip: string;
  requestId: string;
  setCookie(cookie: CookieToSet): void;
  clearCookie(name: string): void;
  /** Set by `caller()` for API-key requests so the wrapper can record usage once the status is known. */
  usage?: { userId: string; apiKeyId: string };
}

/** Route pattern for usage analytics: ids and tokens become `:id`, so no identifiers or secrets are stored. */
export function normalizeEndpoint(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => (/^[a-z]{2,4}_[A-Za-z0-9]{8,}$/.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg) ? ":id" : seg))
    .join("/")
    .slice(0, 120);
}

function recordApiUsage(usage: NonNullable<Ctx<unknown>["usage"]>, req: Request, status: number, startedAt: number) {
  void import("./db")
    .then(async ({ db }) => {
      const { newId } = await import("./ids");
      await db.apiUsage.create({
        data: { id: newId("apu"), userId: usage.userId, apiKeyId: usage.apiKeyId, endpoint: normalizeEndpoint(new URL(req.url).pathname), method: req.method, status, latencyMs: Math.round(Date.now() - startedAt) },
      });
    })
    .catch(() => undefined);
}

type Handler<P> = (ctx: Ctx<P>) => Promise<Response | object | void>;

function errorResponse(err: unknown, requestId: string): Response {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } }, { status: err.status, headers: err.headers });
  }
  if (err instanceof z.ZodError) {
    return json({ error: { code: "validation_error", message: "Some fields are invalid.", details: zodDetails(err) } }, { status: 422 });
  }
  console.error(`[api] unhandled error (request ${requestId})`, err);
  return json({ error: { code: "internal_error", message: "Something went wrong on our side. Please try again." } }, { status: 500 });
}

/**
 * Wraps a route handler: consistent error envelope, cookie plumbing, request ids, and no leaking of
 * internal errors. Handlers may return a Response or a plain object (serialized as JSON, 200).
 */
export function route<P = Record<string, never>>(handler: Handler<P>, opts?: { status?: number }) {
  return async (req: NextRequest, rc: { params: Promise<P> }): Promise<Response> => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const cookies: string[] = [];
    let response: Response;
    let ctx: Ctx<P> | null = null;
    try {
      const params = (await rc.params) ?? ({} as P);
      ctx = {
        req,
        params,
        ip: clientIp(req),
        requestId,
        setCookie: (c) => cookies.push(serializeCookie(c)),
        clearCookie: (name) => cookies.push(serializeCookie({ name, value: "", maxAgeSec: 0 })),
      };
      const out = await handler(ctx);
      if (out instanceof Response) response = out;
      else response = json(out ?? { ok: true }, { status: opts?.status ?? 200 });
    } catch (err) {
      response = errorResponse(err, requestId);
    }
    if (ctx?.usage) recordApiUsage(ctx.usage, req, response.status, startedAt);
    if (cookies.length) {
      // Response headers may be immutable (e.g. responses created by fetch); clone when necessary.
      try {
        for (const c of cookies) response.headers.append("set-cookie", c);
      } catch {
        const headers = new Headers(response.headers);
        for (const c of cookies) headers.append("set-cookie", c);
        response = new Response(response.body, { status: response.status, headers });
      }
    }
    try {
      response.headers.set("x-request-id", requestId);
    } catch {
      /* immutable headers: skip */
    }
    return response;
  };
}

export const idParam = z.string().min(5).max(40).regex(/^[A-Za-z0-9_]+$/);
