import { describe, expect, it } from "vitest";
import { CATALOGS, t } from "@/i18n";
import { en } from "@/i18n/en";
import { ACTIVITY_LABELS } from "@/lib/activity";

describe("i18n", () => {
  it("looks up messages and fills placeholders", () => {
    expect(t("upload.status.waiting")).toBe("Waiting");
    expect(t("storage.percent", { percent: 87 })).toBe("Storage is 87% full.");
    expect(t("plan.upgrade.title", { feature: "Webhooks", plan: "Free" })).toBe("Webhooks isn't included in your Free plan.");
  });
  it("leaves unknown placeholders visible instead of blank", () => {
    expect(t("storage.percent", {})).toBe("Storage is {percent}% full.");
  });
  it("falls back to English for unknown locales", () => {
    expect(t("common.cancel", undefined, "xx")).toBe("Cancel");
  });
  it("every registered catalog covers every English key", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      expect(Object.keys(catalog).sort(), locale).toEqual(Object.keys(en).sort());
    }
  });
  it("feeds the activity labels", () => {
    expect(ACTIVITY_LABELS.deleted).toBe("Moved to trash");
    expect(Object.keys(ACTIVITY_LABELS)).toHaveLength(14);
  });
});
