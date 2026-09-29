import { ensureDataDirs } from "../storage";

let ready: Promise<void> | null = null;

/** Creates the storage/tmp directories once per process. */
export function ensureDataDirsOnce(): Promise<void> {
  ready ??= ensureDataDirs().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}
