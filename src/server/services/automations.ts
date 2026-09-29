import { z } from "zod";
import type { Automation, File as FileRow } from "@prisma/client";
import { isUnlimited } from "@/config/entitlements";
import { db } from "../db";
import { Errors } from "../errors";
import { runAsAutomation, type AppEvent } from "../events";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import { actorForBackgroundWork, assertScope, type Actor } from "./actor";
import { assertFlag } from "./flags";
import { assertFeature, assertLimit } from "./entitlements";
import { entitlementsForScope } from "./limits";
import { notify } from "./notifications";
import { assertCan } from "./permissions";
import { parseJson } from "./serializers";
import { addUsage, getUsage, subjectOf } from "./usage";

/**
 * Automations: "when X happens to a file, if it matches Y, do Z". Triggers come from the internal event
 * bus, runs execute in the background job queue with the owner's permissions, and every run is recorded.
 * Actions performed by an automation never trigger other automations (loop guard, see events.ts).
 */

export const TRIGGERS = {
  "file.uploaded": "A file finishes uploading",
  "file.moved": "A file is moved",
  "file.renamed": "A file is renamed",
  "file.tagged": "A file is tagged",
  "request.upload_received": "Someone uploads through a file request",
} as const;
export type TriggerType = keyof typeof TRIGGERS;
const TRIGGER_KEYS = Object.keys(TRIGGERS) as [TriggerType, ...TriggerType[]];

const conditionSchema = z.object({
  field: z.enum(["name", "extension", "category", "mime", "size", "tag"]),
  op: z.enum(["is", "isNot", "contains", "startsWith", "endsWith", "gt", "lt"]),
  value: z.union([z.string().max(200), z.number()]),
});

const idStr = z.string().min(3).max(64);
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), folderId: idStr.nullable() }),
  z.object({ type: z.literal("copy"), folderId: idStr.nullable() }),
  z.object({ type: z.literal("tag"), tags: z.array(z.string().trim().min(1).max(40)).min(1).max(10) }),
  z.object({ type: z.literal("rename"), pattern: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("share"), expiresInDays: z.number().int().min(1).max(3650).nullable().optional() }),
  z.object({ type: z.literal("notify") }),
]);

export const automationSchema = z.object({
  name: z.string().trim().min(1, "Give the automation a name.").max(80),
  enabled: z.boolean().optional(),
  trigger: z.object({ type: z.enum(TRIGGER_KEYS), folderId: idStr.nullable().optional() }),
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1, "Add at least one action.").max(8),
});
export type AutomationInput = z.infer<typeof automationSchema>;
type Condition = z.infer<typeof conditionSchema>;
type ActionDef = z.infer<typeof actionSchema>;

export interface AutomationDto {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationInput["trigger"];
  conditions: Condition[];
  actions: ActionDef[];
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
}

export interface AutomationRunDto {
  id: string;
  status: string;
  fileId: string | null;
  detail: string | null;
  error: string | null;
  createdAt: string;
}

const toDto = (a: Automation): AutomationDto => ({
  id: a.id,
  name: a.name,
  enabled: a.enabled,
  trigger: parseJson(a.trigger, { type: "file.uploaded" as TriggerType }),
  conditions: parseJson(a.conditions, []),
  actions: parseJson(a.actions, []),
  runCount: a.runCount,
  lastRunAt: a.lastRunAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});

const mine = (actor: Actor) => ({ ownerId: actor.user.id, orgId: actor.workspace.orgId });

async function gate(actor: Actor, write: boolean) {
  await assertFlag("automations");
  assertScope(actor, write ? "automations:write" : "automations:read");
  if (write) assertCan(actor, "manage");
}

/** Folders referenced by an automation must exist in the workspace; validated on save so runs don't fail later. */
async function validateRefs(actor: Actor, input: AutomationInput) {
  const ids = new Set<string>();
  if (input.trigger.folderId) ids.add(input.trigger.folderId);
  for (const a of input.actions) if ((a.type === "move" || a.type === "copy") && a.folderId) ids.add(a.folderId);
  if (!ids.size) return;
  const found = await db.folder.count({
    where: { id: { in: [...ids] }, deletedAt: null, ...(actor.workspace.orgId ? { orgId: actor.workspace.orgId } : { ownerId: actor.user.id, orgId: null }) },
  });
  if (found !== ids.size) throw Errors.validation("One of the folders in this automation doesn't exist.");
}

export async function listAutomations(actor: Actor): Promise<AutomationDto[]> {
  await gate(actor, false);
  return (await db.automation.findMany({ where: mine(actor), orderBy: { createdAt: "desc" } })).map(toDto);
}

export async function createAutomation(actor: Actor, input: AutomationInput): Promise<AutomationDto> {
  await gate(actor, true);
  const ent = await entitlementsForScope({ userId: actor.user.id, orgId: actor.workspace.orgId }, actor.user);
  await assertFeature(ent, "automations");
  if (input.enabled !== false) assertLimit(ent, "automations", await db.automation.count({ where: { ...mine(actor), enabled: true } }));
  await validateRefs(actor, input);
  const row = await db.automation.create({
    data: {
      id: newId("aut"),
      ...mine(actor),
      name: input.name,
      enabled: input.enabled ?? true,
      trigger: JSON.stringify(input.trigger),
      conditions: JSON.stringify(input.conditions),
      actions: JSON.stringify(input.actions),
    },
  });
  return toDto(row);
}

async function ownedAutomation(actor: Actor, id: string) {
  const a = await db.automation.findFirst({ where: { id, ...mine(actor) } });
  if (!a) throw Errors.notFound("That automation doesn't exist.");
  return a;
}

export async function updateAutomation(actor: Actor, id: string, patch: Partial<AutomationInput>): Promise<AutomationDto> {
  await gate(actor, true);
  const existing = await ownedAutomation(actor, id);
  const merged = automationSchema.parse({ ...toDto(existing), ...patch });
  await validateRefs(actor, merged);
  if (merged.enabled && !existing.enabled) {
    const ent = await entitlementsForScope({ userId: actor.user.id, orgId: actor.workspace.orgId }, actor.user);
    await assertFeature(ent, "automations");
    assertLimit(ent, "automations", await db.automation.count({ where: { ...mine(actor), enabled: true } }));
  }
  const row = await db.automation.update({
    where: { id },
    data: {
      name: merged.name,
      enabled: merged.enabled ?? existing.enabled,
      trigger: JSON.stringify(merged.trigger),
      conditions: JSON.stringify(merged.conditions),
      actions: JSON.stringify(merged.actions),
    },
  });
  return toDto(row);
}

export async function deleteAutomation(actor: Actor, id: string): Promise<void> {
  await gate(actor, true);
  await ownedAutomation(actor, id);
  await db.automation.delete({ where: { id } });
}

export async function listRuns(actor: Actor, id: string, limit = 50): Promise<AutomationRunDto[]> {
  await gate(actor, false);
  await ownedAutomation(actor, id);
  const rows = await db.automationRun.findMany({ where: { automationId: id }, orderBy: { createdAt: "desc" }, take: Math.min(limit, 200) });
  return rows.map((r) => ({ id: r.id, status: r.status, fileId: r.fileId, detail: r.detail, error: r.error, createdAt: r.createdAt.toISOString() }));
}

// ---------------------------------------------------------------------------------------------
// Triggering
// ---------------------------------------------------------------------------------------------

export async function enqueueForEvent(event: AppEvent): Promise<void> {
  if (event.data?.viaAutomation) return;
  if (!event.fileId || !(event.type in TRIGGERS)) return;
  const candidates = await db.automation.findMany({ where: { ownerId: event.ownerId, orgId: event.orgId ?? null, enabled: true } });
  for (const a of candidates) {
    const trigger = parseJson<{ type: string; folderId?: string | null }>(a.trigger, { type: "" });
    if (trigger.type !== event.type) continue;
    if (trigger.folderId) {
      const file = await db.file.findUnique({ where: { id: event.fileId }, select: { folderId: true } });
      if (file?.folderId !== trigger.folderId) continue;
    }
    await enqueueJob("run_automation", { automationId: a.id, fileId: event.fileId, eventType: event.type }, { userId: event.ownerId, maxAttempts: 1 });
  }
}

// ---------------------------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------------------------

function matches(c: Condition, file: FileRow, tags: string[]): boolean {
  const str = (v: string | number) => String(v).toLowerCase();
  const target =
    c.field === "name" ? file.originalName.toLowerCase()
    : c.field === "extension" ? file.extension.toLowerCase()
    : c.field === "category" ? file.category
    : c.field === "mime" ? file.mime.toLowerCase()
    : c.field === "size" ? Number(file.size)
    : tags;
  if (c.field === "tag") {
    const has = (tags as string[]).some((t) => t.toLowerCase() === str(c.value));
    return c.op === "isNot" ? !has : has;
  }
  if (c.field === "size") {
    const n = Number(c.value);
    if (c.op === "gt") return (target as number) > n;
    if (c.op === "lt") return (target as number) < n;
    return c.op === "isNot" ? (target as number) !== n : (target as number) === n;
  }
  const t = target as string;
  const v = str(c.value).replace(/^\./, "");
  switch (c.op) {
    case "is": return t === v;
    case "isNot": return t !== v;
    case "contains": return t.includes(v);
    case "startsWith": return t.startsWith(v);
    case "endsWith": return t.endsWith(v);
    default: return false;
  }
}

/** Placeholders for rename patterns. Everything is derived from the file itself; nothing user-controlled reaches a path. */
export function renderPattern(pattern: string, file: { originalName: string; extension: string; createdAt: Date }, now = new Date()): string {
  const dot = file.originalName.lastIndexOf(".");
  const base = dot > 0 ? file.originalName.slice(0, dot) : file.originalName;
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return pattern
    .replaceAll("{name}", base)
    .replaceAll("{ext}", file.extension)
    .replaceAll("{date}", d(now))
    .replaceAll("{year}", String(now.getUTCFullYear()))
    .replaceAll("{month}", String(now.getUTCMonth() + 1).padStart(2, "0"))
    .replaceAll("{created}", d(file.createdAt));
}

export async function runAutomationJob(payload: Record<string, unknown>): Promise<void> {
  const automationId = String(payload.automationId ?? "");
  const fileId = String(payload.fileId ?? "");
  const automation = await db.automation.findUnique({ where: { id: automationId } });
  if (!automation || !automation.enabled) return;
  const record = async (status: "success" | "failed" | "skipped", detail?: string, error?: string) => {
    await db.automationRun.create({ data: { id: newId("arn"), automationId, status, fileId, detail: detail?.slice(0, 500) ?? null, error: error?.slice(0, 500) ?? null, finishedAt: new Date() } });
    if (status !== "skipped") await db.automation.update({ where: { id: automationId }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } });
  };

  const scope = { userId: automation.ownerId, orgId: automation.orgId };
  const ent = await entitlementsForScope(scope);
  if (!ent.features.automations) return record("skipped", "The plan no longer includes automations.");
  const cap = ent.limits.automationRunsPerMonth;
  if (!isUnlimited(cap) && (await getUsage(subjectOf(scope), "automationRuns")) >= cap) return record("skipped", "The monthly automation run limit was reached.");

  const file = await db.file.findFirst({ where: { id: fileId, deletedAt: null, status: "available", ...(automation.orgId ? { orgId: automation.orgId } : { ownerId: automation.ownerId, orgId: null }) }, include: { tags: { include: { tag: true } } } });
  if (!file) return record("skipped", "The file is no longer available.");
  const tagNames = file.tags.map((t) => t.tag.name);
  const conditions = parseJson<Condition[]>(automation.conditions, []);
  if (!conditions.every((c) => matches(c, file, tagNames))) return record("skipped", "The file didn't match the conditions.");

  await addUsage(subjectOf(scope), "automationRuns", 1);
  const actions = parseJson<ActionDef[]>(automation.actions, []);
  const done: string[] = [];
  try {
    const actor = await actorForBackgroundWork(automation.ownerId, automation.orgId);
    await runAsAutomation(async () => {
      const files = await import("./files");
      const tags = await import("./tags");
      const shares = await import("./shares");
      for (const action of actions) {
        switch (action.type) {
          case "move":
            await files.updateFile(actor, fileId, { folderId: action.folderId });
            done.push("moved");
            break;
          case "copy":
            await files.copyFile(actor, fileId, { folderId: action.folderId });
            done.push("copied");
            break;
          case "tag":
            await tags.applyTags(actor, { fileIds: [fileId], add: action.tags });
            done.push(`tagged ${action.tags.join(", ")}`);
            break;
          case "rename": {
            const current = await db.file.findUniqueOrThrow({ where: { id: fileId } });
            await files.updateFile(actor, fileId, { name: renderPattern(action.pattern, current) });
            done.push("renamed");
            break;
          }
          case "archive":
            await files.updateFile(actor, fileId, { archived: true });
            done.push("archived");
            break;
          case "share": {
            const expiresAt = action.expiresInDays ? new Date(Date.now() + action.expiresInDays * 86400_000) : null;
            await shares.createShare(actor, { fileId, expiresAt });
            done.push("shared");
            break;
          }
          case "notify":
            await notify({ userId: automation.ownerId, type: "release", title: `Automation “${automation.name}” ran`, body: `It processed ${file.originalName}.`, href: `/files?file=${fileId}` });
            done.push("notified");
            break;
        }
      }
    });
    await record("success", done.join(", "));
  } catch (err) {
    await record("failed", done.length ? `Completed before failing: ${done.join(", ")}` : undefined, (err as Error).message);
  }
}
