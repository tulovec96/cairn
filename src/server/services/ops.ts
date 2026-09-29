import fsp from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { env } from "../env";
import { newId } from "../ids";
import { getSettings } from "../settings";
import { storage } from "../storage";

/**
 * Operational jobs: database backups and health checks. Backups cover the database only (users, metadata,
 * settings). File blobs live in the storage provider and should be backed up with that provider's own
 * tools; the admin panel says so.
 */

export const backupDir = () => path.join(env.dataDir, "backups");

export async function backupDatabase(opts: { force?: boolean } = {}): Promise<{ id: string; path: string; size: number } | null> {
  const settings = await getSettings();
  if (!settings.backups.enabled && !opts.force) return null;
  const id = newId("bkp");
  await db.backupRecord.create({ data: { id, kind: "database", status: "running" } });
  try {
    await fsp.mkdir(backupDir(), { recursive: true });
    const file = path.join(backupDir(), `cairn-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    // VACUUM INTO writes a consistent, compacted copy while the database stays online. The path is generated here.
    await db.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const size = (await fsp.stat(file)).size;
    await db.backupRecord.update({ where: { id }, data: { status: "ok", path: file, size: BigInt(size), finishedAt: new Date() } });
    await pruneBackups(settings.backups.keep);
    return { id, path: file, size };
  } catch (err) {
    await db.backupRecord.update({ where: { id }, data: { status: "failed", error: (err as Error).message.slice(0, 300), finishedAt: new Date() } });
    throw err;
  }
}

async function pruneBackups(keep: number) {
  const ok = await db.backupRecord.findMany({ where: { kind: "database", status: "ok" }, orderBy: { createdAt: "desc" } });
  for (const old of ok.slice(keep)) {
    if (old.path) await fsp.unlink(old.path).catch(() => undefined);
    await db.backupRecord.delete({ where: { id: old.id } });
  }
}

interface CheckResult {
  service: string;
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

async function timed(service: string, fn: () => Promise<string | undefined>): Promise<CheckResult> {
  const t = Date.now();
  try {
    const detail = await fn();
    return { service, ok: true, latencyMs: Date.now() - t, detail };
  } catch (err) {
    return { service, ok: false, latencyMs: Date.now() - t, detail: (err as Error).message.slice(0, 200) };
  }
}

/** Probes the real dependencies and stores the outcome. The public status page is built from these rows only. */
export async function runStatusChecks(): Promise<CheckResult[]> {
  const settings = await getSettings();
  const results: CheckResult[] = [];
  results.push(await timed("database", async () => void (await db.$queryRaw`SELECT 1`)));
  results.push(
    await timed("storage", async () => {
      const h = await storage().health();
      if (!h.ok) throw new Error(h.detail ?? "Storage is not healthy.");
      return undefined;
    }),
  );
  results.push(
    await timed("jobs", async () => {
      const oldest = await db.job.findFirst({ where: { status: "queued", runAt: { lte: new Date(Date.now() - 5 * 60_000) } }, orderBy: { runAt: "asc" }, select: { runAt: true } });
      if (oldest) throw new Error(`Jobs have been waiting since ${oldest.runAt.toISOString()}.`);
      return undefined;
    }),
  );
  if (settings.scanner.provider !== "none") {
    results.push(
      await timed("scanner", async () => {
        const { getScanProvider } = await import("../scan");
        const scanner = getScanProvider(settings);
        if (scanner?.ping && !(await scanner.ping())) throw new Error("The scanner is not reachable.");
        return undefined;
      }),
    );
  }
  await db.statusCheck.createMany({ data: results.map((r) => ({ id: newId("chk"), service: r.service, ok: r.ok, latencyMs: r.latencyMs ?? null, detail: r.detail ?? null })) });
  return results;
}
