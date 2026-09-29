import { db } from "../db";
import { Errors } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import { getScanProvider } from "../scan";
import { getSettings } from "../settings";
import { storage } from "../storage";
import { audit } from "./audit";
import { notify } from "./notifications";
import { revokeSharesForFiles } from "./shares";

export type QuarantineSource = "scan" | "admin" | "report";

/** Blocks a file: no downloads, no new shares, links revoked. It stays in storage until an administrator decides. */
export async function quarantineFile(fileId: string, note: string, opts?: { source?: QuarantineSource; signature?: string; revokeShares?: boolean }) {
  const source = opts?.source ?? "admin";
  const file = await db.file.update({ where: { id: fileId }, data: { status: "quarantined", quarantineNote: note.slice(0, 300) } });
  await db.quarantineItem.upsert({
    where: { fileId },
    create: { id: newId("qrn"), fileId, reason: note.slice(0, 300), source, signature: opts?.signature ?? null },
    update: { reason: note.slice(0, 300), source, signature: opts?.signature ?? null, state: "pending", reviewedById: null, reviewedAt: null, note: null },
  });
  if (opts?.revokeShares !== false) await revokeSharesForFiles([fileId], "the file was blocked by a security check");
  await notify({ userId: file.ownerId, type: source === "scan" ? "malware_detected" : "file_quarantined", title: source === "scan" ? "Malware detected in an upload" : "A file was quarantined", body: `${file.originalName}: ${note}`, href: `/file/${file.id}` });
  await emit({ type: "file.quarantined", workspaceId: file.orgId ?? file.ownerId, ownerId: file.ownerId, orgId: file.orgId, actorLabel: source === "scan" ? "Malware scan" : "Administrator", fileId, targetName: file.originalName, data: { source, note } });
  return file;
}

/** Admin review: the file is safe after all. It becomes available again (its old share links stay revoked). */
export async function releaseFile(fileId: string, adminId: string, note?: string) {
  await db.quarantineItem.updateMany({ where: { fileId }, data: { state: "released", reviewedById: adminId, reviewedAt: new Date(), note: note ?? null } });
  return db.file.update({ where: { id: fileId }, data: { status: "available", quarantineNote: null, scanStatus: "not_scanned" } });
}

/** Admin review: yes, it's malicious. The file stays blocked and is flagged so it can't be released by mistake. */
export async function confirmMalicious(fileId: string, adminId: string, note?: string) {
  const item = await db.quarantineItem.findUnique({ where: { fileId } });
  if (!item) throw Errors.notFound("That file isn't in quarantine.");
  await db.quarantineItem.update({ where: { fileId }, data: { state: "confirmed", reviewedById: adminId, reviewedAt: new Date(), note: note ?? null } });
  await audit({ actorType: "admin", actorId: adminId, action: "admin.quarantine_confirmed", targetType: "file", targetId: fileId, metadata: { note } });
}

/**
 * Scans one file via the configured provider. Throws on transient scanner failures until the
 * final attempt so the job queue can retry; on the final attempt the configured policy applies.
 */
export async function runScan(fileId: string, attempt: number, maxAttempts: number): Promise<void> {
  const file = await db.file.findUnique({ where: { id: fileId } });
  if (!file || file.deletedAt) return;
  if (file.status !== "scanning" && file.scanStatus !== "pending") return;
  const settings = await getSettings();
  const scanner = getScanProvider(settings);

  if (!scanner) {
    await db.file.update({ where: { id: fileId }, data: { status: "available", scanStatus: "not_scanned" } });
    return afterAvailable(fileId);
  }

  await db.file.update({ where: { id: fileId }, data: { scanStatus: "scanning" } });
  const scan = await db.virusScan.create({ data: { id: newId("scn"), fileId, provider: scanner.name, status: "error" } });
  const result = await scanner.scan(storage().createReadStream(file.storageKey), Number(file.size));

  if (result.status === "error" && attempt < maxAttempts) {
    await db.virusScan.update({ where: { id: scan.id }, data: { status: "error", details: result.details?.slice(0, 500), finishedAt: new Date() } });
    throw new Error(`Scanner error: ${result.details ?? "unknown"}`);
  }

  await db.virusScan.update({
    where: { id: scan.id },
    data: { status: result.status, signature: result.signature ?? null, details: result.details?.slice(0, 500), finishedAt: new Date() },
  });

  if (result.status === "clean") {
    await db.file.update({ where: { id: fileId }, data: { status: "available", scanStatus: "clean" } });
    return afterAvailable(fileId);
  }
  if (result.status === "infected") {
    await db.file.update({ where: { id: fileId }, data: { scanStatus: "infected" } });
    await quarantineFile(fileId, `Malware detected (${result.signature ?? "unknown signature"})`, { source: "scan", signature: result.signature });
    await audit({ actorType: "system", action: "file.scan_infected", targetType: "file", targetId: fileId, metadata: { signature: result.signature } });
    return;
  }
  // Final scanner error: apply policy, and be honest about the scan state.
  if (settings.scanner.onError === "quarantine") {
    await db.file.update({ where: { id: fileId }, data: { scanStatus: "error" } });
    await quarantineFile(fileId, "The security scan could not be completed", { source: "scan", revokeShares: false });
  } else {
    await db.file.update({ where: { id: fileId }, data: { status: "available", scanStatus: "error" } });
    await afterAvailable(fileId);
  }
}

async function afterAvailable(fileId: string) {
  await enqueueJob("media", { fileId }, { dedupeKey: `media:${fileId}:${Date.now()}` });
  const file = await db.file.findUnique({ where: { id: fileId }, select: { ownerId: true, orgId: true, originalName: true } });
  void file;
}

/** Re-queues scanning for a file (admin action or after enabling a scanner). */
export async function requestRescan(fileId: string) {
  const settings = await getSettings();
  if (settings.scanner.provider === "none") return false;
  await db.file.update({ where: { id: fileId }, data: { status: "scanning", scanStatus: "pending" } });
  await enqueueJob("scan_file", { fileId }, { dedupeKey: `scan:${fileId}:${Date.now()}` });
  return true;
}
