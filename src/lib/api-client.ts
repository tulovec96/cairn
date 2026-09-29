import type { ApiErrorBody } from "./types";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, details?: unknown, retryAfter?: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }

  /** Field-level messages returned by validation errors, keyed by field path. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as Array<{ path?: string; message?: string }>) {
        if (d?.path && d.message && !out[d.path]) out[d.path] = d.message;
      }
    }
    return out;
  }
}

export async function toApiError(res: Response): Promise<ApiClientError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error body */
  }
  const retry = Number(res.headers.get("retry-after") ?? "") || undefined;
  return new ApiClientError(
    res.status,
    body?.error?.code ?? "http_error",
    body?.error?.message ?? (res.status >= 500 ? "The server ran into a problem. Please try again." : `Request failed (${res.status}).`),
    body?.error?.details,
    retry,
  );
}

interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiClientError(0, "network_error", "Can't reach the server. Check your connection and try again.");
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error && err.name !== "AbortError") return err.message || fallback;
  return fallback;
}

export function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function shareLink(token: string): string {
  return `${window.location.origin}/d/${token}`;
}
