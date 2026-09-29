import type { Readable } from "node:stream";

export interface ByteRange {
  start: number;
  /** inclusive */
  end: number;
}

export interface StorageHealth {
  provider: string;
  ok: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  detail?: string;
}

/**
 * Blob storage contract. The application only ever addresses blobs by generated keys, never by
 * user-supplied names. A local-disk implementation ships with the app; an S3-compatible
 * implementation only needs to satisfy this interface.
 */
export interface StorageProvider {
  readonly name: string;
  /** Move (or upload) a finished local file into storage under `key`. The source is consumed. */
  putFile(key: string, sourcePath: string): Promise<void>;
  putStream(key: string, stream: Readable): Promise<{ size: number }>;
  createReadStream(key: string, range?: ByteRange): Readable;
  stat(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
  /** Server-side copy of a blob (no data flows through the application where the backend supports it). */
  copy(fromKey: string, toKey: string): Promise<void>;
  health(): Promise<StorageHealth>;
  /** Enumerates stored blobs (used by the orphan-cleanup job). */
  walk(): AsyncGenerator<{ key: string; size: number; mtimeMs: number }>;
}
