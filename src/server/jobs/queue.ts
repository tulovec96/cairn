import { db } from "../db";
import { newId } from "../ids";

export type JobType =
  | "finalize_upload"
  | "scan_file"
  | "thumbnail"
  | "media"
  | "send_email"
  | "deliver_webhook"
  | "run_automation"
  | "import_url"
  | "build_export"
  | "backup_database"
  | "status_check"
  | "share_expiry_notices"
  | "billing_sync"
  | "build_archive"
  | "expire_files"
  | "purge_trash"
  | "cleanup_uploads"
  | "cleanup_archives"
  | "cleanup_sessions"
  | "storage_gc"
  | "stats_snapshot"
  | "job_gc"
  | "prune_notifications";

const g = globalThis as unknown as { __cairnWake?: () => void };

export function registerWake(fn: () => void) {
  g.__cairnWake = fn;
}

export function wakeWorker() {
  g.__cairnWake?.();
}

export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown> = {},
  opts?: { runAt?: Date; dedupeKey?: string; maxAttempts?: number; userId?: string },
): Promise<boolean> {
  // Check first so the common "already queued" case doesn't surface as a logged database error.
  if (opts?.dedupeKey && (await db.job.findUnique({ where: { dedupeKey: opts.dedupeKey }, select: { id: true } }))) return false;
  try {
    await db.job.create({
      data: {
        id: newId("job"),
        type,
        payload: JSON.stringify(payload),
        runAt: opts?.runAt ?? new Date(),
        dedupeKey: opts?.dedupeKey ?? null,
        maxAttempts: opts?.maxAttempts ?? 5,
        userId: opts?.userId ?? null,
      },
    });
    g.__cairnWake?.();
    return true;
  } catch (err) {
    // Unique constraint on dedupeKey: an identical job already exists.
    if ((err as { code?: string }).code === "P2002") return false;
    throw err;
  }
}
