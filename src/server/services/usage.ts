import { db } from "../db";
import { Errors } from "../errors";
import { isUnlimited } from "@/config/entitlements";
import type { Scope } from "./actor";
import { entitlementsForScope } from "./limits";

export type UsageMetric = "downloadBytes" | "uploadBytes" | "apiRequests" | "webhookDeliveries" | "automationRuns";

export const currentPeriod = (d = new Date()) => d.toISOString().slice(0, 7);

export interface UsageSubject {
  type: "user" | "org";
  id: string;
}

export const subjectOf = (scope: Scope): UsageSubject => (scope.orgId ? { type: "org", id: scope.orgId } : { type: "user", id: scope.userId });

/** Atomic-enough monthly counters: increment (creating the row when needed). */
export async function addUsage(subject: UsageSubject, metric: UsageMetric, amount: number | bigint = 1): Promise<void> {
  if (!amount) return;
  const period = currentPeriod();
  const inc = BigInt(amount);
  const where = { subjectType_subjectId_period_metric: { subjectType: subject.type, subjectId: subject.id, period, metric } };
  try {
    await db.usageCounter.update({ where, data: { value: { increment: inc } } });
  } catch {
    try {
      await db.usageCounter.create({ data: { id: `use_${subject.type}_${subject.id}_${period}_${metric}`.slice(0, 120), subjectType: subject.type, subjectId: subject.id, period, metric, value: inc } });
    } catch {
      // Lost a race with another writer creating the row: increment it instead.
      await db.usageCounter.update({ where, data: { value: { increment: inc } } });
    }
  }
}

export async function getUsage(subject: UsageSubject, metric: UsageMetric, period = currentPeriod()): Promise<number> {
  const row = await db.usageCounter.findUnique({ where: { subjectType_subjectId_period_metric: { subjectType: subject.type, subjectId: subject.id, period, metric } } });
  return Number(row?.value ?? 0n);
}

export async function usageHistory(subject: UsageSubject, metric: UsageMetric, months = 6): Promise<Array<{ period: string; value: number }>> {
  const rows = await db.usageCounter.findMany({ where: { subjectType: subject.type, subjectId: subject.id, metric }, orderBy: { period: "desc" }, take: months });
  return rows.map((r) => ({ period: r.period, value: Number(r.value) })).reverse();
}

/** Blocks a download when the owner's monthly transfer allowance is used up. */
export async function assertTransferAvailable(scope: Scope, bytes: number): Promise<void> {
  const ent = await entitlementsForScope(scope);
  const cap = ent.limits.transferBytesPerMonth;
  if (isUnlimited(cap)) return;
  const used = await getUsage(subjectOf(scope), "downloadBytes");
  if (used + bytes > cap) throw Errors.rateLimited(3600, "This link has used up its monthly transfer allowance. Please try again later or contact the owner.");
}
