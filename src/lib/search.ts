/**
 * Search query language.
 *
 *   report q3               words match the file name (all words must match)
 *   "annual report"         quoted phrase
 *   type:image              category (image, video, audio, document, archive, code, other)
 *   ext:png                 extension
 *   mime:image/*            content type (prefix with *)
 *   folder:videos           files in folders whose name matches (and their subfolders)
 *   tag:project             files carrying a tag (repeat for AND)
 *   owner:me                uploader (email or "me")
 *   size:>1GB               also <, >=, <=, =, and ranges 10MB..1GB
 *   created:>2024-01-01     dates: ISO (after that day), today, yesterday
 *   modified:<7d            relative values are AGE: changed within the last 7 days (d, w, m, y)
 *   created:>1y             ...and this means older than a year
 *   is:favorite|shared|private|archived
 *   status:available|scanning|quarantined
 *   has:versions|comments|description|tags
 *   -tag:draft  -ext:tmp    prefix any term with - to exclude it
 *
 * Adding an operator = adding an entry to OPERATORS below (parsing) and to the compiler in
 * src/server/services/search.ts. Unknown operators are reported, never silently dropped.
 */

export type Comparator = ">" | ">=" | "<" | "<=" | "=";

export type NumericFilter = { op: Comparator; value: number } | { op: "between"; min: number; max: number };

export type Filter =
  | { kind: "type"; value: string; negate: boolean }
  | { kind: "ext"; value: string; negate: boolean }
  | { kind: "mime"; value: string; prefix: boolean; negate: boolean }
  | { kind: "folder"; value: string; negate: boolean }
  | { kind: "tag"; value: string; negate: boolean }
  | { kind: "owner"; value: string; negate: boolean }
  | { kind: "size"; filter: NumericFilter }
  | { kind: "created"; filter: NumericFilter }
  | { kind: "modified"; filter: NumericFilter }
  | { kind: "is"; value: "favorite" | "shared" | "private" | "archived"; negate: boolean }
  | { kind: "status"; value: string; negate: boolean }
  | { kind: "has"; value: "versions" | "comments" | "description" | "tags"; negate: boolean };

export interface ParsedQuery {
  words: Array<{ text: string; negate: boolean }>;
  filters: Filter[];
  errors: string[];
}

const CATEGORIES = ["image", "video", "audio", "document", "archive", "code", "other"];
const SIZE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };

export function parseSize(input: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(input.trim());
  if (!m) return null;
  const unit = m[2].toLowerCase() || "b";
  const mult = SIZE_UNITS[unit];
  return mult ? Math.round(Number(m[1]) * mult) : null;
}

/** Dates as epoch ms. A relative value like "7d" means "that long ago". */
export function parseDate(input: string, now = Date.now()): number | null {
  const v = input.trim().toLowerCase();
  if (v === "today") return new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
  if (v === "yesterday") return new Date(new Date(now).setHours(0, 0, 0, 0)).getTime() - 86400_000;
  const rel = /^(\d+)([dwmy])$/.exec(v);
  if (rel) {
    const n = Number(rel[1]);
    const day = 86400_000;
    return now - n * (rel[2] === "d" ? day : rel[2] === "w" ? 7 * day : rel[2] === "m" ? 30 * day : 365 * day);
  }
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(input.trim())) {
    const t = Date.parse(input.trim());
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function parseNumeric(raw: string, parse: (s: string) => number | null, relativeDates: boolean): NumericFilter | string {
  const range = /^(.+)\.\.(.+)$/.exec(raw);
  if (range) {
    const a = parse(range[1]);
    const b = parse(range[2]);
    if (a === null || b === null) return `Couldn't read the range "${raw}".`;
    return { op: "between", min: Math.min(a, b), max: Math.max(a, b) };
  }
  const m = /^(>=|<=|>|<|=)?(.+)$/.exec(raw);
  if (!m) return `Couldn't read "${raw}".`;
  const value = parse(m[2]);
  if (value === null) return `Couldn't read "${raw}".`;
  let op = (m[1] as Comparator | undefined) ?? "=";
  // For relative dates, "created:>7d" is intuitively "newer than 7 days ago", which is a *later* timestamp.
  if (relativeDates && /^\d+[dwmy]$/i.test(m[2].trim())) op = op === ">" ? "<" : op === ">=" ? "<=" : op === "<" ? ">" : op === "<=" ? ">=" : op;
  return { op, value };
}

type OperatorParser = (value: string, negate: boolean) => Filter | string;

const OPERATORS: Record<string, OperatorParser> = {
  type: (v, negate) => (CATEGORIES.includes(v.toLowerCase()) ? { kind: "type", value: v.toLowerCase(), negate } : `Unknown type "${v}". Try ${CATEGORIES.join(", ")}.`),
  ext: (v, negate) => ({ kind: "ext", value: v.replace(/^\./, "").toLowerCase().slice(0, 16), negate }),
  mime: (v, negate) => ({ kind: "mime", value: v.replace(/\*$/, "").toLowerCase(), prefix: v.endsWith("*") || !v.includes("/"), negate }),
  folder: (v, negate) => ({ kind: "folder", value: v.toLowerCase(), negate }),
  tag: (v, negate) => ({ kind: "tag", value: v.toLowerCase(), negate }),
  owner: (v, negate) => ({ kind: "owner", value: v.toLowerCase(), negate }),
  size: (v) => {
    const f = parseNumeric(v, parseSize, false);
    return typeof f === "string" ? f : { kind: "size", filter: f };
  },
  created: (v) => {
    const f = parseNumeric(v, parseDate, true);
    return typeof f === "string" ? f : { kind: "created", filter: f };
  },
  modified: (v) => {
    const f = parseNumeric(v, parseDate, true);
    return typeof f === "string" ? f : { kind: "modified", filter: f };
  },
  is: (v, negate) => {
    const x = v.toLowerCase();
    return x === "favorite" || x === "starred" || x === "shared" || x === "private" || x === "archived"
      ? { kind: "is", value: x === "starred" ? "favorite" : x, negate }
      : `Unknown value "is:${v}". Try favorite, shared, private or archived.`;
  },
  status: (v, negate) => ({ kind: "status", value: v.toLowerCase(), negate }),
  has: (v, negate) => {
    const x = v.toLowerCase();
    return x === "versions" || x === "comments" || x === "description" || x === "tags" ? { kind: "has", value: x, negate } : `Unknown value "has:${v}". Try versions, comments, description or tags.`;
  },
};

export const SEARCH_OPERATORS = Object.keys(OPERATORS);

/** Splits on whitespace but keeps "quoted phrases" (and key:"quoted value") together. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of input) {
    if (ch === '"') {
      quoted = !quoted;
      cur += ch;
    } else if (/\s/.test(ch) && !quoted) {
      if (cur) tokens.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

export function parseQuery(input: string | null | undefined): ParsedQuery {
  const out: ParsedQuery = { words: [], filters: [], errors: [] };
  if (!input) return out;
  for (const raw of tokenize(input.slice(0, 500)).slice(0, 30)) {
    let token = raw;
    let negate = false;
    if (token.startsWith("-") && token.length > 1) {
      negate = true;
      token = token.slice(1);
    }
    const m = /^([a-z]+):(.*)$/i.exec(token);
    if (m) {
      const key = m[1].toLowerCase();
      const value = m[2].replace(/^"|"$/g, "");
      const parser = OPERATORS[key];
      if (!parser) {
        out.errors.push(`Unknown search operator "${key}:". Supported: ${SEARCH_OPERATORS.join(", ")}.`);
        continue;
      }
      if (!value) continue; // "type:" while still typing
      const f = parser(value, negate);
      if (typeof f === "string") out.errors.push(f);
      else out.filters.push(f);
    } else {
      const text = token.replace(/^"|"$/g, "").toLowerCase();
      if (text) out.words.push({ text, negate });
    }
  }
  return out;
}

export function isEmptyQuery(q: ParsedQuery): boolean {
  return q.words.length === 0 && q.filters.length === 0;
}

/** Smart collections are just saved queries with a fixed name. */
export const COLLECTIONS = {
  recent: { label: "Recent", query: "modified:<14d" },
  large: { label: "Large files", query: "size:>100MB" },
  images: { label: "Images", query: "type:image" },
  videos: { label: "Videos", query: "type:video" },
  audio: { label: "Audio", query: "type:audio" },
  documents: { label: "Documents", query: "type:document" },
  shared: { label: "Shared", query: "is:shared" },
  favorites: { label: "Favorites", query: "is:favorite" },
} as const;

export type CollectionKey = keyof typeof COLLECTIONS;
