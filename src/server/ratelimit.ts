import { Errors } from "./errors";
import type { RateRule } from "./settings";

type Bucket = { count: number; resetAt: number };

const g = globalThis as unknown as { __cairnRate?: Map<string, Bucket>; __cairnRateGc?: NodeJS.Timeout };
const store: Map<string, Bucket> = (g.__cairnRate ??= new Map());

if (!g.__cairnRateGc) {
  g.__cairnRateGc = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
  }, 60_000);
  g.__cairnRateGc.unref?.();
}

export type HitResult = { ok: boolean; remaining: number; retryAfter: number; limit: number };

/** Fixed-window counter. Process-local, which matches the single-node SQLite deployment model. */
export function hit(key: string, rule: RateRule, cost = 1): HitResult {
  const now = Date.now();
  let b = store.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + rule.windowSec * 1000 };
    store.set(key, b);
  }
  b.count += cost;
  const ok = b.count <= rule.limit;
  return { ok, remaining: Math.max(0, rule.limit - b.count), retryAfter: Math.ceil((b.resetAt - now) / 1000), limit: rule.limit };
}

/** Throws a 429 ApiError when any of the keys are over the rule. All keys are always counted. */
export function enforce(keys: string | string[], rule: RateRule, message?: string) {
  const list = Array.isArray(keys) ? keys : [keys];
  let worst: HitResult | null = null;
  for (const key of list) {
    const r = hit(key, rule);
    if (!r.ok && (!worst || r.retryAfter > worst.retryAfter)) worst = r;
  }
  if (worst) throw Errors.rateLimited(worst.retryAfter, message);
}

export function count(key: string): number {
  const b = store.get(key);
  return b && b.resetAt > Date.now() ? b.count : 0;
}

export function remainingLockout(key: string, rule: RateRule): number {
  const b = store.get(key);
  if (!b || b.resetAt <= Date.now() || b.count < rule.limit) return 0;
  return Math.ceil((b.resetAt - Date.now()) / 1000);
}

export function reset(key: string) {
  store.delete(key);
}
