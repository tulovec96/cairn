import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS } from "@/config/plans";
import { FEATURE_KEYS, FEATURES, LIMIT_KEYS, LIMITS, UNLIMITED, emptyFeatures, formatLimit, isUnlimited } from "@/config/entitlements";
import { formatBytes, formatDuration, formatMoney, pluralize, timeAgo, timeUntil } from "@/lib/format";

describe("entitlement catalogue", () => {
  it("gives every feature a label, description and group", () => {
    for (const k of FEATURE_KEYS) {
      expect(FEATURES[k].label.length).toBeGreaterThan(2);
      expect(FEATURES[k].description.length).toBeGreaterThan(10);
      expect(FEATURES[k].group).toBeTruthy();
    }
  });
  it("gives every limit a unit and label", () => {
    for (const k of LIMIT_KEYS) {
      expect(LIMITS[k].label).toBeTruthy();
      expect(["bytes", "count", "days", "perMinute", "perMonth"]).toContain(LIMITS[k].unit);
    }
  });
  it("builds an all-off feature map", () => {
    const f = emptyFeatures();
    expect(Object.keys(f).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(Object.values(f).every((v) => v === false)).toBe(true);
  });
});

describe("default plans", () => {
  it("define every feature and limit exactly once", () => {
    for (const p of DEFAULT_PLANS) {
      expect(Object.keys(p.features).sort(), p.key).toEqual([...FEATURE_KEYS].sort());
      expect(Object.keys(p.limits).sort(), p.key).toEqual([...LIMIT_KEYS].sort());
      for (const k of LIMIT_KEYS) expect(Number.isInteger(p.limits[k]) && p.limits[k] >= UNLIMITED, `${p.key}.${k}`).toBe(true);
    }
  });
  it("have unique keys and exactly one default", () => {
    const keys = DEFAULT_PLANS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_PLANS.filter((p) => p.isDefault)).toHaveLength(1);
  });
  it("never make a higher tier worse than a lower one on storage or file size", () => {
    const sorted = [...DEFAULT_PLANS].sort((a, b) => a.priceMonthlyCents - b.priceMonthlyCents);
    const rank = (n: number) => (isUnlimited(n) ? Number.POSITIVE_INFINITY : n);
    for (let i = 1; i < sorted.length; i++) {
      expect(rank(sorted[i].limits.storageBytes), `${sorted[i].key} storage`).toBeGreaterThanOrEqual(rank(sorted[i - 1].limits.storageBytes));
      expect(rank(sorted[i].limits.maxFileBytes), `${sorted[i].key} max file`).toBeGreaterThanOrEqual(rank(sorted[i - 1].limits.maxFileBytes));
    }
  });
});

describe("formatLimit", () => {
  it("prints unlimited, bytes, days and rates", () => {
    expect(formatLimit("storageBytes", UNLIMITED)).toBe("Unlimited");
    expect(formatLimit("storageBytes", 5 * 1024 ** 3)).toBe("5 GB");
    expect(formatLimit("trashRetentionDays", 30)).toBe("30 days");
    expect(formatLimit("trashRetentionDays", 0)).toBe("None");
    expect(formatLimit("apiRequestsPerMinute", 1200)).toBe("1,200 / min");
  });
});

describe("formatting helpers", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(null)).toBe("—");
  });
  it("formats money without needless decimals", () => {
    expect(formatMoney(900)).toBe("$9");
    expect(formatMoney(950)).toBe("$9.50");
    expect(formatMoney(0)).toBe("$0");
  });
  it("formats durations", () => {
    expect(formatDuration(65)).toBe("1m 5s");
    expect(formatDuration(3725)).toBe("1h 2m");
  });
  it("pluralizes", () => {
    expect(pluralize(1, "file")).toBe("1 file");
    expect(pluralize(2, "file")).toBe("2 files");
    expect(pluralize(0, "copy", "copies")).toBe("0 copies");
  });
  it("describes relative times", () => {
    const now = Date.UTC(2030, 0, 1, 12);
    expect(timeAgo(new Date(now - 2 * 3600_000), now)).toMatch(/2 h|2 hours/);
    expect(timeUntil(new Date(now + 3 * 86400_000), now)).toMatch(/3 d|3 days/);
  });
});
