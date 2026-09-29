/**
 * Batch rename patterns.
 *
 *   {name}       original name without extension
 *   {ext}        original extension (without the dot)
 *   {number}     1, 2, 3 … in the current order; {number:3} pads to 001, 002 …
 *   {date}       today, YYYY-MM-DD
 *   {created}    the file's creation date, YYYY-MM-DD
 *
 * If the pattern doesn't mention {ext} the original extension is kept, so "photo-{number}" turns
 * "IMG_1.jpg" into "photo-1.jpg". The same code powers the live preview in the browser and the
 * server-side apply, so what you see is what happens.
 */

export interface RenameInput {
  id: string;
  name: string;
  folderId: string | null;
  createdAt: string;
}

export interface RenameRow {
  id: string;
  from: string;
  to: string;
  conflict: null | "duplicate" | "exists" | "empty" | "invalid";
}

const FORBIDDEN = /[\u0000-\u001f<>:"|?*\\/]/g;

function splitName(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? { base: name.slice(0, i), ext: name.slice(i + 1) } : { base: name, ext: "" };
}

export function isoDay(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

export function computeBatchRename(
  items: RenameInput[],
  pattern: string,
  opts: { start?: number; today?: Date; existing?: Map<string | null, Set<string>> } = {},
): RenameRow[] {
  const start = Number.isFinite(opts.start) ? (opts.start as number) : 1;
  const today = isoDay(opts.today ?? new Date());
  const usesExt = /\{ext\}/i.test(pattern);
  const rows: RenameRow[] = items.map((item, index) => {
    const { base, ext } = splitName(item.name);
    let out = pattern
      .replace(/\{name\}/gi, base)
      .replace(/\{ext\}/gi, ext)
      .replace(/\{date\}/gi, today)
      .replace(/\{created\}/gi, isoDay(item.createdAt))
      .replace(/\{number(?::(\d{1,2}))?\}/gi, (_m, pad) => String(start + index).padStart(pad ? Number(pad) : 0, "0"));
    out = out.replace(FORBIDDEN, "_").trim();
    if (!usesExt && ext && out) out = `${out}.${ext}`;
    return { id: item.id, from: item.name, to: out, conflict: !out || out === "." || out === ".." ? "empty" : null };
  });

  // Collisions: two files in one folder ending up with the same name, or a name that already exists there.
  const seen = new Map<string, number>();
  const folderOf = new Map(items.map((i) => [i.id, i.folderId]));
  for (const row of rows) {
    if (row.conflict) continue;
    const key = `${folderOf.get(row.id) ?? ""}\u0000${row.to.toLowerCase()}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row.conflict) continue;
    const folder = folderOf.get(row.id) ?? null;
    const key = `${folder ?? ""}\u0000${row.to.toLowerCase()}`;
    if ((seen.get(key) ?? 0) > 1) row.conflict = "duplicate";
    else if (row.to.toLowerCase() !== row.from.toLowerCase() && opts.existing?.get(folder)?.has(row.to.toLowerCase())) row.conflict = "exists";
  }
  return rows;
}

export const CONFLICT_MESSAGES: Record<NonNullable<RenameRow["conflict"]>, string> = {
  duplicate: "Two files would get this name",
  exists: "A file with this name already exists",
  empty: "The name would be empty",
  invalid: "Not a valid name",
};
