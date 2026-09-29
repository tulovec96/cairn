import type { Organization, User } from "@prisma/client";
import { DEFAULT_PLANS, type PlanDefinition } from "@/config/plans";
import { FEATURES, FEATURE_KEYS, LIMITS, LIMIT_KEYS, UNLIMITED, emptyFeatures, isUnlimited, type FeatureKey, type LimitKey, type PlanFeatures, type PlanLimits } from "@/config/entitlements";
import { db } from "../db";
import { Errors } from "../errors";

export interface PlanRecord extends PlanDefinition {
  providerPrices: Record<string, { month?: string; year?: string }>;
}

export interface Entitlements {
  planKey: string;
  planName: string;
  features: PlanFeatures;
  limits: PlanLimits;
  subject: { type: "user" | "org"; id: string };
}

const g = globalThis as unknown as { __cairnPlans?: { at: number; plans: PlanRecord[] }; __cairnPlansSeeded?: boolean };

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalize(row: { key: string; name: string; description: string; priceMonthlyCents: number; priceYearlyCents: number; currency: string; features: string; limits: string; isPublic: boolean; isDefault: boolean; sortOrder: number; providerPrices: string }): PlanRecord {
  const base = DEFAULT_PLANS.find((p) => p.key === row.key);
  const storedFeatures = parseJson<Partial<PlanFeatures>>(row.features, {});
  const storedLimits = parseJson<Partial<PlanLimits>>(row.limits, {});
  const features = emptyFeatures(false);
  for (const k of FEATURE_KEYS) features[k] = storedFeatures[k] ?? base?.features[k] ?? false;
  const limits = {} as PlanLimits;
  for (const k of LIMIT_KEYS) limits[k] = typeof storedLimits[k] === "number" ? (storedLimits[k] as number) : (base?.limits[k] ?? 0);
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    priceMonthlyCents: row.priceMonthlyCents,
    priceYearlyCents: row.priceYearlyCents,
    currency: row.currency,
    features,
    limits,
    isPublic: row.isPublic,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    highlights: base?.highlights ?? [],
    providerPrices: parseJson(row.providerPrices, {}),
  };
}

/** Writes the built-in plans that are missing from the database. Never overwrites admin edits. */
export async function ensureDefaultPlans(): Promise<void> {
  const existing = new Set((await db.plan.findMany({ select: { key: true } })).map((p) => p.key));
  for (const p of DEFAULT_PLANS) {
    if (existing.has(p.key)) continue;
    await db.plan.create({
      data: {
        key: p.key,
        name: p.name,
        description: p.description,
        priceMonthlyCents: p.priceMonthlyCents,
        priceYearlyCents: p.priceYearlyCents,
        currency: p.currency,
        features: JSON.stringify(p.features),
        limits: JSON.stringify(p.limits),
        isPublic: p.isPublic,
        isDefault: p.isDefault,
        sortOrder: p.sortOrder,
      },
    });
  }
  g.__cairnPlansSeeded = true;
  g.__cairnPlans = undefined;
}

export async function listPlans(opts?: { publicOnly?: boolean }): Promise<PlanRecord[]> {
  if (!g.__cairnPlansSeeded) await ensureDefaultPlans();
  let plans = g.__cairnPlans && Date.now() - g.__cairnPlans.at < 5000 ? g.__cairnPlans.plans : null;
  if (!plans) {
    plans = (await db.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { key: "asc" }] })).map(normalize);
    g.__cairnPlans = { at: Date.now(), plans };
  }
  return opts?.publicOnly ? plans.filter((p) => p.isPublic) : plans;
}

export function invalidatePlanCache() {
  g.__cairnPlans = undefined;
}

export async function getPlan(key: string): Promise<PlanRecord> {
  const plans = await listPlans();
  return plans.find((p) => p.key === key) ?? plans.find((p) => p.isDefault) ?? plans[0];
}

export async function defaultPlanKey(): Promise<string> {
  const plans = await listPlans();
  return (plans.find((p) => p.isDefault) ?? plans[0]).key;
}

type UserPlanFields = Pick<User, "id" | "planKey" | "quotaBytes" | "maxFileBytes">;

export async function entitlementsForUser(user: UserPlanFields): Promise<Entitlements> {
  const plan = await getPlan(user.planKey);
  const limits = { ...plan.limits };
  // Administrators can grant a specific account more (or less) than its plan gives.
  if (user.quotaBytes != null) limits.storageBytes = Number(user.quotaBytes);
  if (user.maxFileBytes != null) limits.maxFileBytes = Number(user.maxFileBytes);
  return { planKey: plan.key, planName: plan.name, features: plan.features, limits, subject: { type: "user", id: user.id } };
}

export async function entitlementsForOrg(org: Pick<Organization, "id" | "planKey">): Promise<Entitlements> {
  const plan = await getPlan(org.planKey);
  return { planKey: plan.key, planName: plan.name, features: plan.features, limits: plan.limits, subject: { type: "org", id: org.id } };
}

/** The lowest-priced public plan that includes the feature, for upgrade prompts. */
export async function requiredPlanForFeature(feature: FeatureKey): Promise<PlanRecord | null> {
  const plans = (await listPlans({ publicOnly: true })).filter((p) => p.features[feature]);
  return plans.sort((a, b) => a.priceMonthlyCents - b.priceMonthlyCents || a.sortOrder - b.sortOrder)[0] ?? null;
}

export async function assertFeature(ent: Entitlements, feature: FeatureKey): Promise<void> {
  if (ent.features[feature]) return;
  const needed = await requiredPlanForFeature(feature);
  throw Errors.planRequired(feature, FEATURES[feature].label, needed?.name ?? null);
}

/** Throws when creating one more of something would exceed the plan's limit. `current` is the existing count. */
export function assertLimit(ent: Entitlements, key: LimitKey, current: number): void {
  const max = ent.limits[key];
  if (isUnlimited(max)) return;
  if (current >= max) throw Errors.planLimit(key, LIMITS[key].label, max);
}

export function limitOf(ent: Entitlements, key: LimitKey): number {
  return ent.limits[key];
}

export { UNLIMITED, isUnlimited };
