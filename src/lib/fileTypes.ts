export type FileCategory = "image" | "video" | "audio" | "document" | "archive" | "code" | "other";
export type PreviewKind = "image" | "svg" | "video" | "audio" | "pdf" | "text";

export const CATEGORY_LABELS: Record<FileCategory, string> = {
  image: "Images",
  video: "Video",
  audio: "Audio",
  document: "Documents",
  archive: "Archives",
  code: "Code",
  other: "Other",
};

const CODE_EXT = new Set([
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "css", "scss", "html", "htm", "xml", "yml", "yaml", "toml", "ini", "py", "rb", "go", "rs",
  "java", "kt", "c", "h", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "bat", "ps1", "sql", "lua", "swift", "dart", "vue", "svelte", "gradle", "conf", "env",
]);
const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "log", "rtf", "nfo", "srt", "vtt", "diff", "patch", "rst"]);
const ARCHIVE_EXT = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "cab", "dmg"]);
const DOC_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "epub", "pages", "numbers", "key"]);

const RASTER_IMAGE_MIME = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon",
]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/ogg", "video/quicktime"]);
const AUDIO_MIME = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/flac", "audio/x-flac", "audio/aac", "audio/mp4",
  "audio/x-m4a", "audio/webm", "audio/opus",
]);

export function categorize(mime: string, ext: string): FileCategory {
  const m = mime.toLowerCase();
  const e = ext.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (ARCHIVE_EXT.has(e) || /zip|x-rar|x-7z|x-tar|gzip|x-bzip|x-xz/.test(m)) return "archive";
  if (CODE_EXT.has(e)) return "code";
  if (DOC_EXT.has(e) || TEXT_EXT.has(e) || m === "application/pdf" || m.startsWith("text/") || /officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(m)) return "document";
  return "other";
}

/**
 * Decides whether a file can be shown inline, and how. Anything that could execute in a browser
 * (HTML, scripts, XML with stylesheets) is only ever shown as inert text.
 */
export function previewKind(mime: string, ext: string): PreviewKind | null {
  const m = mime.toLowerCase();
  const e = ext.toLowerCase();
  if (m === "image/svg+xml" || e === "svg") return "svg";
  if (RASTER_IMAGE_MIME.has(m)) return "image";
  if (VIDEO_MIME.has(m)) return "video";
  if (AUDIO_MIME.has(m)) return "audio";
  if (m === "application/pdf") return "pdf";
  if (CODE_EXT.has(e) || TEXT_EXT.has(e) || m.startsWith("text/") || m === "application/json" || m === "application/xml") return "text";
  return null;
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return "";
  const ext = name.slice(i + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(ext) ? ext : "";
}
