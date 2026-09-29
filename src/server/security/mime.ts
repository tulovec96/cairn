import { fileTypeFromFile } from "file-type";
import mimeTypes from "mime-types";
import { categorize, extensionOf, type FileCategory } from "@/lib/fileTypes";

export interface DetectedType {
  mime: string;
  extension: string;
  category: FileCategory;
  /** true when the type came from the file's magic bytes rather than its name */
  sniffed: boolean;
}

/**
 * Determines the content type from the bytes on disk, falling back to the extension. The client's
 * declared Content-Type is never used: it is trivially spoofable.
 */
export async function detectType(path: string, fileName: string): Promise<DetectedType> {
  const nameExt = extensionOf(fileName);
  let mime: string | undefined;
  let sniffed = false;
  try {
    const found = await fileTypeFromFile(path);
    if (found) {
      mime = found.mime;
      sniffed = true;
    }
  } catch {
    /* unreadable header: fall through to the extension */
  }
  if (!mime && nameExt) {
    const byName = mimeTypes.lookup(nameExt);
    if (byName) mime = byName.split(";")[0];
  }
  mime ??= "application/octet-stream";
  const extension = nameExt || (sniffed ? (mimeTypes.extension(mime) || "") : "");
  return { mime, extension, category: categorize(mime, extension), sniffed };
}
