import { db } from "../db";
import { runScan } from "../services/scanning";
import { buildArchive } from "../services/archives";
import { cleanupArchives, cleanupSessions, cleanupUploads, expireFiles, expireVersions, jobGc, shareExpiryNotices, statsSnapshot, storageGc } from "../services/maintenance";
import { purgeExpiredTrash } from "../services/trash";
import { processMedia } from "../services/media";
import { finalizeUpload } from "../services/uploads";
import { pruneNotifications } from "../services/notifications";
import { deliverEmail } from "../services/email";
import { attemptDelivery } from "../services/webhooks";
import { runAutomationJob } from "../services/automations";
import { buildExport, runImport } from "../services/transfer";
import { backupDatabase, runStatusChecks } from "../services/ops";
import { applyScheduledCancellations } from "../services/billing";
import { enqueueJob, registerWake, type JobType } from "./queue";

interface JobContext {
  attempt: number;
  maxAttempts: number;
}

type Handler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<void>;

const HANDLERS: Record<JobType, Handler> = {
  finalize_upload: async (p) => finalizeUpload(String(p.uploadId)),
  scan_file: async (p, ctx) => runScan(String(p.fileId), ctx.attempt, ctx.maxAttempts),
  thumbnail: async (p) => processMedia(String(p.fileId)),
  media: async (p) => processMedia(String(p.fileId)),
  send_email: async (p) => deliverEmail(String(p.emailId)),
  deliver_webhook: async (p, ctx) => void (await attemptDelivery(String(p.deliveryId), { final: ctx.attempt >= ctx.maxAttempts })),
  run_automation: async (p) => runAutomationJob(p),
  import_url: async (p) => runImport(String(p.importId)),
  build_export: async (p) => buildExport(String(p.exportId)),
  backup_database: async () => void (await backupDatabase()),
  status_check: async () => void (await runStatusChecks()),
  share_expiry_notices: async () => shareExpiryNotices(),
  billing_sync: async () => void (await applyScheduledCancellations()),
  build_archive: async (p) => buildArchive(String(p.archiveId)),
  expire_files: async () => {
    await expireFiles();
    await expireVersions();
  },
  purge_trash: async () => void (await purgeExpiredTrash()),
  cleanup_uploads: async () => cleanupUploads(),
  cleanup_archives: async () => cleanupArchives(),
  cleanup_sessions: async () => cleanupSessions(),
  storage_gc: async () => void (await storageGc()),
  stats_snapshot: async () => statsSnapshot(),
  job_gc: async () => jobGc(),
  prune_notifications: async () => pruneNotifications(),
};

/** Recurring maintenance. Each run is a normal job (visible to admins, retried on failure), de-duplicated per time bucket. */
const PERIODIC: Array<{ type: JobType; everySec: number }> = [
  { type: "expire_files", everySec: 60 },
  { type: "purge_trash", everySec: 300 },
  { type: "cleanup_uploads", everySec: 300 },
  { type: "cleanup_archives", everySec: 600 },
  { type: "cleanup_sessions", everySec: 3600 },
  { type: "storage_gc", everySec: 6 * 3600 },
  { type: "stats_snapshot", everySec: 3600 },
  { type: "job_gc", everySec: 6 * 3600 },
  { type: "status_check", everySec: 300 },
  { type: "share_expiry_notices", everySec: 3600 },
  { type: "billing_sync", everySec: 3600 },
  { type: "backup_database", everySec: 24 * 3600 },
];

const CONCURRENCY = 3;
const STALE_RUNNING_MS = 30 * 60_000;

const g = globalThis as unknown as { __cairnWorker?: { stop: () => void } };

function backoffMs(attempt: number): number {
  return Math.min(10 * 60_000, 5_000 * 2 ** (attempt - 1));
}

type ClaimedJob = { id: string; type: string; payload: string; attempt: number; maxAttempts: number };

async function claimNext(): Promise<ClaimedJob | null> {
  for (let i = 0; i < 5; i++) {
    const next = await db.job.findFirst({ where: { status: "queued", runAt: { lte: new Date() } }, orderBy: { runAt: "asc" } });
    if (!next) return null;
    const claimed = await db.job.updateMany({ where: { id: next.id, status: "queued" }, data: { status: "running", lockedAt: new Date(), attempts: { increment: 1 } } });
    if (claimed.count === 1) return { id: next.id, type: next.type, payload: next.payload, attempt: next.attempts + 1, maxAttempts: next.maxAttempts };
  }
  return null;
}

async function execute(job: ClaimedJob): Promise<void> {
  const handler = HANDLERS[job.type as JobType];
  try {
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    await handler(JSON.parse(job.payload || "{}"), { attempt: job.attempt, maxAttempts: job.maxAttempts });
    await db.job.update({ where: { id: job.id }, data: { status: "done", finishedAt: new Date(), lastError: null } });
  } catch (err) {
    const message = ((err as Error).message || "Job failed").slice(0, 500);
    const final = job.attempt >= job.maxAttempts;
    console.error(`[jobs] ${job.type} failed (attempt ${job.attempt}/${job.maxAttempts}): ${message}`);
    await db.job.update({
      where: { id: job.id },
      data: final
        ? { status: "failed", finishedAt: new Date(), lastError: message }
        : { status: "queued", runAt: new Date(Date.now() + backoffMs(job.attempt)), lastError: message, lockedAt: null },
    });
  }
}

async function enqueuePeriodic() {
  const now = Date.now();
  for (const p of PERIODIC) {
    const bucket = Math.floor(now / (p.everySec * 1000));
    await enqueueJob(p.type, {}, { dedupeKey: `periodic:${p.type}:${bucket}`, maxAttempts: 3 }).catch(() => undefined);
  }
}

export async function startWorker(): Promise<void> {
  if (g.__cairnWorker) return;

  // A previous process may have died mid-job: put its running jobs back in the queue.
  await db.job.updateMany({ where: { status: "running" }, data: { status: "queued", lockedAt: null } });

  let active = 0;
  let pumping = false;
  let stopped = false;

  const pump = () => {
    if (stopped || pumping) return;
    pumping = true;
    (async () => {
      try {
        while (!stopped && active < CONCURRENCY) {
          const job = await claimNext();
          if (!job) break;
          active++;
          void execute(job)
            .catch((err) => console.error("[jobs] unexpected error", (err as Error).message))
            .finally(() => {
              active--;
              pump();
            });
        }
      } catch (err) {
        console.error("[jobs] worker error", (err as Error).message);
      } finally {
        pumping = false;
      }
    })();
  };

  const tick = setInterval(pump, 1000);
  const periodic = setInterval(async () => {
    await enqueuePeriodic();
    await db.job.updateMany({ where: { status: "running", lockedAt: { lte: new Date(Date.now() - STALE_RUNNING_MS) } }, data: { status: "queued", lockedAt: null } }).catch(() => undefined);
  }, 30_000);
  tick.unref?.();
  periodic.unref?.();

  registerWake(pump);
  g.__cairnWorker = {
    stop: () => {
      stopped = true;
      clearInterval(tick);
      clearInterval(periodic);
      g.__cairnWorker = undefined;
    },
  };
  await enqueuePeriodic();
  pump();
  console.log("[jobs] background worker started");
}
export function stopWorker() {
  g.__cairnWorker?.stop();
}
