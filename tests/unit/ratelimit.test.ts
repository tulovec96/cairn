import { describe, expect, it } from "vitest";
import { ApiError } from "@/server/errors";
import { count, enforce, hit, remainingLockout, reset } from "@/server/ratelimit";

let n = 0;
const key = () => `unit:${Date.now()}:${n++}`;

describe("rate limiter", () => {
  it("allows up to the limit, then refuses", () => {
    const k = key();
    const rule = { limit: 3, windowSec: 60 };
    expect([1, 2, 3].map(() => hit(k, rule).ok)).toEqual([true, true, true]);
    const over = hit(k, rule);
    expect(over.ok).toBe(false);
    expect(over.remaining).toBe(0);
    expect(over.retryAfter).toBeGreaterThan(0);
    expect(over.retryAfter).toBeLessThanOrEqual(60);
  });
  it("reports remaining requests", () => {
    const k = key();
    expect(hit(k, { limit: 5, windowSec: 60 }).remaining).toBe(4);
    expect(hit(k, { limit: 5, windowSec: 60 }).remaining).toBe(3);
  });
  it("counts independent keys separately", () => {
    const rule = { limit: 1, windowSec: 60 };
    const a = key();
    const b = key();
    expect(hit(a, rule).ok).toBe(true);
    expect(hit(b, rule).ok).toBe(true);
    expect(hit(a, rule).ok).toBe(false);
  });
  it("throws a 429 with Retry-After information from enforce()", () => {
    const k = key();
    const rule = { limit: 1, windowSec: 30 };
    enforce(k, rule);
    try {
      enforce(k, rule, "Slow down.");
      throw new Error("expected enforce to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(429);
      expect((err as ApiError).message).toBe("Slow down.");
    }
  });
  it("counts every key even when an earlier one is already over", () => {
    const a = key();
    const b = key();
    const rule = { limit: 1, windowSec: 60 };
    enforce([a, b], rule);
    expect(() => enforce([a, b], rule)).toThrow();
    expect(count(a)).toBe(2);
    expect(count(b)).toBe(2);
  });
  it("reset clears a key and lockout reflects the window", () => {
    const k = key();
    const rule = { limit: 1, windowSec: 60 };
    hit(k, rule);
    hit(k, rule);
    expect(remainingLockout(k, rule)).toBeGreaterThan(0);
    reset(k);
    expect(count(k)).toBe(0);
    expect(remainingLockout(k, rule)).toBe(0);
  });
});
