import { extensionOf } from "@/lib/fileTypes";

const RESERVED = new Set([
  "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

// Control characters, bidi overrides/isolates (filename spoofing such as "invoice\u202Egpj.exe"), BOM, zero-width.
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const MAX_BYTES = 200;

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let out = "";
  for (const ch of value) {
    if (Buffer.byteLength(out + ch) > maxBytes) break;
    out += ch;
  }
  return out;
}

/**
 * Produces a display-safe name. The result is never used as a filesystem path (storage uses generated
 * keys), but it is still stripped of anything that could mislead users or break headers/archives.
 */
export function sanitizeFilename(input: string, fallback = "file"): string {
  let name = String(input ?? "");
  name = name.toWellFormed().normalize("NFC");
  name = name.replace(FORBIDDEN_CHARS, "");
  // Keep only the last path segment, whichever separator style was used.
  name = name.split(/[\\/]/).pop() ?? "";
  name = name.replace(/[<>:"|?*]/g, "_");
  name = name.trim().replace(/[. ]+$/, "").replace(/^\.+(?=.)/, "");
  if (name === "." || name === "..") name = "";
  if (!name) return fallback;

  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let safeBase = base;
  if (RESERVED.has(safeBase.toLowerCase())) safeBase = `_${safeBase}`;
  const extBytes = Buffer.byteLength(ext);
  const room = Math.max(1, MAX_BYTES - Math.min(extBytes, 32));
  safeBase = truncateUtf8(safeBase, room).trim() || fallback;
  return safeBase + truncateUtf8(ext, 32);
}

/** Folder names: same rules, but no extension logic. */
export function sanitizeFolderName(input: string): string {
  let name = String(input ?? "").toWellFormed().normalize("NFC").replace(FORBIDDEN_CHARS, "");
  name = name.replace(/[\\/]/g, "_").replace(/[<>:"|?*]/g, "_").trim().replace(/[. ]+$/, "");
  if (name === "." || name === "..") name = "";
  if (RESERVED.has(name.toLowerCase())) name = `_${name}`;
  return truncateUtf8(name, MAX_BYTES).trim();
}

export function safeExtension(name: string): string {
  return extensionOf(name);
}

/** "report.pdf" -> "report (1).pdf" when `taken` (lower-cased) already contains the candidate. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0;
  const base = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : "";
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

/** RFC 6266 / 5987 Content-Disposition value that is safe against header injection. */
export function contentDisposition(type: "attachment" | "inline", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
