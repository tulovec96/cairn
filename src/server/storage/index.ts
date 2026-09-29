import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { LocalStorageProvider } from "./local";
import { s3FromEnv } from "./s3";
import type { StorageProvider } from "./types";

export type { StorageProvider, ByteRange, StorageHealth } from "./types";

const g = globalThis as unknown as { __cairnStorage?: StorageProvider };

/**
 * The single place that decides which storage backend is used: local disk by default, or any S3-compatible
 * object store with STORAGE_PROVIDER=s3 (see .env.example). A new backend only has to satisfy `StorageProvider`.
 */
export function storage(): StorageProvider {
  return (g.__cairnStorage ??= process.env.STORAGE_PROVIDER === "s3" ? s3FromEnv(process.env, path.join(env.tmpDir, "s3")) : new LocalStorageProvider(env.storageDir));
}

export function setStorageForTests(provider: StorageProvider | undefined) {
  g.__cairnStorage = provider;
}

export function stagingPath(uploadId: string): string {
  return path.join(env.tmpDir, "uploads", `${uploadId}.part`);
}

export async function ensureDataDirs() {
  await fsp.mkdir(path.join(env.tmpDir, "uploads"), { recursive: true });
  await fsp.mkdir(path.join(env.tmpDir, "archives"), { recursive: true });
  await fsp.mkdir(env.storageDir, { recursive: true });
}
