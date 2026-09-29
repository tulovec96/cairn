/** A file's `thumbnailKey` is a base name; the actual blobs are `<base>.s`, `<base>.m` and `<base>.l`. */
export const THUMB_SUFFIXES = ["s", "m", "l"] as const;

export const thumbKeysOf = (base: string | null | undefined): string[] => (base ? THUMB_SUFFIXES.map((s) => `${base}.${s}`) : []);
