import { z } from "zod";
import { db } from "../db";
import { fingerprint } from "../crypto";
import { Errors } from "../errors";
import { newId } from "../ids";
import * as rate from "../ratelimit";
import { getSettings } from "../settings";
import { audit } from "./audit";
import { assertFileInSharedFolder } from "./publicShares";
import { resolveShare } from "./shares";
import { quarantineFile } from "./scanning";
import { destroyFiles } from "./files";

export const reportSchema = z.object({
  category: z.enum(["malware", "copyright", "illegal", "spam", "abuse", "other"]),
  description: z.string().trim().min(5, "Describe the problem in a few words.").max(2000),
  contact: z.string().trim().max(200).optional(),
  /** Folder shares: which file inside the folder is being reported. */
  fileId: z.string().max(40).optional(),
});

export async function createReport(token: string, input: z.infer<typeof reportSchema>, ip: string): Promise<{ id: string }> {
  const settings = await getSettings();
  rate.enforce(`report:${ip}`, settings.rateLimits.report, "You've sent several reports recently. Please wait before sending another.");
  const { share, file, folder } = await resolveShare(token, { allowExhausted: true });
  let target = file;
  if (!target && folder && input.fileId) {
    target = await assertFileInSharedFolder(folder, input.fileId).catch(() => null);
  }
  if (!target) throw Errors.validation("Choose the file you want to report.");
  const reporterKey = fingerprint(ip);
  const dup = await db.abuseReport.findFirst({
    where: { fileId: target.id, reporterKey, status: { in: ["open", "reviewing"] }, createdAt: { gte: new Date(Date.now() - 86400_000) } },
    select: { id: true },
  });
  if (dup) return { id: dup.id };
  const report = await db.abuseReport.create({
    data: {
      id: newId("rpt"),
      fileId: target.id,
      fileName: target.originalName,
      fileOwnerId: target.ownerId,
      shareId: share.id,
      category: input.category,
      description: input.description,
      contact: input.contact || null,
      reporterKey,
    },
  });
  await audit({ actorType: "system", action: "report.created", targetType: "file", targetId: target.id, metadata: { category: input.category, reportId: report.id } });
  return { id: report.id };
}

export const resolveReportSchema = z.object({
  status: z.enum(["reviewing", "actioned", "dismissed"]),
  note: z.string().trim().max(1000).optional(),
  action: z.enum(["none", "quarantine", "delete"]).default("none"),
});

export async function resolveReport(adminId: string, reportId: string, input: z.infer<typeof resolveReportSchema>, ip?: string) {
  const report = await db.abuseReport.findUnique({ where: { id: reportId }, include: { file: true } });
  if (!report) throw Errors.notFound("That report doesn't exist.");
  const done = input.status !== "reviewing";
  // Record the decision first: deleting the file afterwards keeps the report (its file link becomes null).
  await db.abuseReport.update({
    where: { id: reportId },
    data: { status: input.status, resolutionNote: input.note ?? report.resolutionNote, resolvedById: done ? adminId : null, resolvedAt: done ? new Date() : null },
  });
  if (report.file) {
    if (input.action === "quarantine") await quarantineFile(report.file.id, `Removed after a ${report.category} report`, { source: "report" });
    if (input.action === "delete") await destroyFiles([report.file]);
  }
  await audit({ actorType: "admin", actorId: adminId, action: "admin.report_resolved", targetType: "report", targetId: reportId, ip, metadata: { status: input.status, action: input.action } });
}
