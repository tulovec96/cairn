import { describe, expect, it } from "vitest";
import { computeBatchRename } from "@/lib/batchRename";
import { isEmptyQuery, parseDate, parseQuery, parseSize, tokenize } from "@/lib/search";

const DAY = 86400_000;

describe("parseSize", () => {
  it.each([
    ["10", 10],
    ["1kb", 1024],
    ["1.5MB", 1572864],
    ["2g", 2 * 1024 ** 3],
    ["1 TB", 1024 ** 4],
  ])("%s", (input, bytes) => {
    expect(parseSize(input)).toBe(bytes);
  });
  it("rejects nonsense", () => {
    expect(parseSize("big")).toBeNull();
    expect(parseSize("5 parsecs")).toBeNull();
    expect(parseSize("")).toBeNull();
  });
});

describe("parseDate", () => {
  const now = Date.UTC(2030, 5, 15, 12, 0, 0);
  it("reads relative ages", () => {
    expect(parseDate("7d", now)).toBe(now - 7 * DAY);
    expect(parseDate("2w", now)).toBe(now - 14 * DAY);
    expect(parseDate("1y", now)).toBe(now - 365 * DAY);
  });
  it("reads ISO dates", () => {
    expect(parseDate("2030-01-31")).toBe(Date.parse("2030-01-31"));
  });
  it("rejects invalid input", () => {
    expect(parseDate("someday")).toBeNull();
    expect(parseDate("2030-13-99")).toBeNull();
  });
});

describe("tokenize", () => {
  it("keeps quoted phrases together", () => {
    expect(tokenize('annual "big report" type:pdf')).toEqual(["annual", '"big report"', "type:pdf"]);
  });
  it("keeps key:\"quoted value\" together", () => {
    expect(tokenize('folder:"my docs" x')).toEqual(['folder:"my docs"', "x"]);
  });
});

describe("parseQuery", () => {
  it("collects plain words", () => {
    const q = parseQuery("report q3");
    expect(q.words.map((w) => w.text)).toEqual(["report", "q3"]);
    expect(q.filters).toEqual([]);
    expect(q.errors).toEqual([]);
  });
  it("parses type, ext and mime filters", () => {
    const q = parseQuery("type:image ext:.PNG mime:image/*");
    expect(q.filters).toEqual([
      { kind: "type", value: "image", negate: false },
      { kind: "ext", value: "png", negate: false },
      { kind: "mime", value: "image/", prefix: true, negate: false },
    ]);
  });
  it("supports negation with a leading minus", () => {
    const q = parseQuery("-tag:draft -ext:tmp -old");
    expect(q.filters).toEqual([
      { kind: "tag", value: "draft", negate: true },
      { kind: "ext", value: "tmp", negate: true },
    ]);
    expect(q.words).toEqual([{ text: "old", negate: true }]);
  });
  it("parses size comparisons and ranges", () => {
    expect(parseQuery("size:>1GB").filters).toEqual([{ kind: "size", filter: { op: ">", value: 1024 ** 3 } }]);
    expect(parseQuery("size:10MB..1GB").filters).toEqual([{ kind: "size", filter: { op: "between", min: 10 * 1024 ** 2, max: 1024 ** 3 } }]);
    expect(parseQuery("size:1GB..10MB").filters).toEqual([{ kind: "size", filter: { op: "between", min: 10 * 1024 ** 2, max: 1024 ** 3 } }]);
  });
  it("treats relative dates as ages", () => {
    // "modified:<7d" = changed within the last 7 days = a timestamp LATER than 7 days ago
    const f = parseQuery("modified:<7d").filters[0];
    expect(f).toMatchObject({ kind: "modified", filter: { op: ">" } });
    const g = parseQuery("created:>1y").filters[0];
    expect(g).toMatchObject({ kind: "created", filter: { op: "<" } });
  });
  it("parses is: and has:", () => {
    expect(parseQuery("is:starred has:versions").filters).toEqual([
      { kind: "is", value: "favorite", negate: false },
      { kind: "has", value: "versions", negate: false },
    ]);
  });
  it("reports unknown values instead of dropping them silently", () => {
    expect(parseQuery("type:spaceship").errors[0]).toMatch(/Unknown type/);
    expect(parseQuery("is:cool").errors[0]).toMatch(/Unknown value/);
    expect(parseQuery("size:huge").errors.length).toBe(1);
  });
  it("reports unknown operators", () => {
    const q = parseQuery("flavor:mint");
    expect(q.errors.length + q.words.length).toBeGreaterThan(0);
  });
  it("recognizes an empty query", () => {
    expect(isEmptyQuery(parseQuery(""))).toBe(true);
    expect(isEmptyQuery(parseQuery("   "))).toBe(true);
    expect(isEmptyQuery(parseQuery(null))).toBe(true);
    expect(isEmptyQuery(parseQuery("a"))).toBe(false);
    expect(isEmptyQuery(parseQuery("type:image"))).toBe(false);
  });
});

describe("computeBatchRename", () => {
  const items = [
    { id: "1", name: "IMG_1.jpg", folderId: null, createdAt: "2030-01-05T10:00:00Z" },
    { id: "2", name: "IMG_2.jpg", folderId: null, createdAt: "2030-02-06T10:00:00Z" },
    { id: "3", name: "notes", folderId: null, createdAt: "2030-03-07T10:00:00Z" },
  ];
  const today = new Date("2031-04-09T12:00:00Z");

  it("keeps the original extension when the pattern has no {ext}", () => {
    const rows = computeBatchRename(items, "photo-{number}", { today });
    expect(rows.map((r) => r.to)).toEqual(["photo-1.jpg", "photo-2.jpg", "photo-3"]);
  });
  it("uses {ext} literally when present", () => {
    expect(computeBatchRename([items[0]], "{name}.{ext}.bak", { today })[0].to).toBe("IMG_1.jpg.bak");
  });
  it("pads numbers and honours the start value", () => {
    const rows = computeBatchRename(items, "s-{number:3}", { today, start: 10 });
    expect(rows.map((r) => r.to)).toEqual(["s-010.jpg", "s-011.jpg", "s-012"]);
  });
  it("substitutes dates", () => {
    const rows = computeBatchRename(items, "{date}_{created}_{name}", { today });
    expect(rows[0].to).toBe("2031-04-09_2030-01-05_IMG_1.jpg");
  });
  it("flags names that would collide", () => {
    const rows = computeBatchRename(items, "same", { today });
    expect(rows[0].conflict).toBe("duplicate");
    expect(rows[1].conflict).toBe("duplicate");
    expect(rows[2].conflict).toBeNull();
  });
  it("flags names that already exist in the folder", () => {
    const existing = new Map<string | null, Set<string>>([[null, new Set(["photo-1.jpg"])]]);
    const rows = computeBatchRename(items, "photo-{number}", { today, existing });
    expect(rows[0].conflict).toBe("exists");
    expect(rows[1].conflict).toBeNull();
  });
  it("does not treat two folders' identical names as a collision", () => {
    const rows = computeBatchRename(
      [
        { id: "a", name: "x.txt", folderId: "f1", createdAt: "2030-01-01T00:00:00Z" },
        { id: "b", name: "y.txt", folderId: "f2", createdAt: "2030-01-01T00:00:00Z" },
      ],
      "same",
      { today },
    );
    expect(rows.map((r) => r.conflict)).toEqual([null, null]);
  });
  it("replaces path characters and reports empty results", () => {
    expect(computeBatchRename([items[0]], "a/b:c", { today })[0].to).toBe("a_b_c.jpg");
    expect(computeBatchRename([items[0]], "   ", { today })[0].conflict).toBe("empty");
    expect(computeBatchRename([items[2]], "", { today })[0].conflict).toBe("empty");
  });
});
