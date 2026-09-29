export async function register() {
  // Background jobs (scans, thumbnails, archives, expiry, cleanup) run inside the server process.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("./server/env");
    if (!env.workerEnabled) return;
    const { ensureDataDirs } = await import("./server/storage");
    const { startWorker } = await import("./server/jobs/worker");
    await ensureDataDirs();
    await startWorker();
  }
}
