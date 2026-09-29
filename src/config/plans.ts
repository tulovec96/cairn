import { UNLIMITED, emptyFeatures, type FeatureKey, type PlanFeatures, type PlanLimits } from "./entitlements";

/**
 * Default plan definitions. They are written to the database on first start (existing rows are never
 * overwritten), after which administrators edit prices, features and limits in the admin panel.
 * Prices live here and in the Plan table only. UI components never hardcode them.
 */

const GB = 1024 ** 3;
const TB = 1024 ** 4;
const MB = 1024 ** 2;

export interface PlanDefinition {
  key: string;
  name: string;
  description: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  features: PlanFeatures;
  limits: PlanLimits;
  isPublic: boolean;
  isDefault: boolean;
  sortOrder: number;
  /** Optional marketing bullets shown under the price, in addition to the generated feature list. */
  highlights: string[];
}

const on = (...keys: FeatureKey[]): PlanFeatures => {
  const f = emptyFeatures(false);
  for (const k of keys) f[k] = true;
  return f;
};

export const DEFAULT_PLANS: PlanDefinition[] = [
  {
    key: "free",
    name: "Free",
    description: "For personal files and the occasional share.",
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
    currency: "usd",
    features: on("api", "fileVersioning", "comments", "fileRequests"),
    limits: {
      storageBytes: 5 * GB,
      maxFileBytes: 1 * GB,
      transferBytesPerMonth: 25 * GB,
      apiRequestsPerMinute: 60,
      apiKeys: 2,
      webhooks: 0,
      webhookDeliveriesPerMonth: 0,
      automations: 0,
      automationRunsPerMonth: 0,
      versionsPerFile: 3,
      versionRetentionDays: 30,
      trashRetentionDays: 14,
      maxRetentionDays: UNLIMITED,
      fileRequests: 1,
      organizations: 0,
      orgMembers: 0,
    },
    isPublic: true,
    isDefault: true,
    sortOrder: 0,
    highlights: [],
  },
  {
    key: "pro",
    name: "Pro",
    description: "For people who move a lot of files and want automation.",
    priceMonthlyCents: 900,
    priceYearlyCents: 9000,
    currency: "usd",
    features: on("api", "webhooks", "fileVersioning", "urlImport", "shareLimits", "sharePermissions", "shareAnalytics", "customBranding", "embeds", "fileRequests", "portals", "comments", "automations", "advancedAnalytics"),
    limits: {
      storageBytes: 200 * GB,
      maxFileBytes: 10 * GB,
      transferBytesPerMonth: 500 * GB,
      apiRequestsPerMinute: 600,
      apiKeys: 10,
      webhooks: 5,
      webhookDeliveriesPerMonth: 10_000,
      automations: 10,
      automationRunsPerMonth: 5_000,
      versionsPerFile: 25,
      versionRetentionDays: 365,
      trashRetentionDays: 30,
      maxRetentionDays: UNLIMITED,
      fileRequests: 10,
      organizations: 1,
      orgMembers: 5,
    },
    isPublic: true,
    isDefault: false,
    sortOrder: 1,
    highlights: [],
  },
  {
    key: "business",
    name: "Business",
    description: "For teams that share storage, roles and workflows.",
    priceMonthlyCents: 2400,
    priceYearlyCents: 24000,
    currency: "usd",
    features: on(
      "api", "webhooks", "fileVersioning", "urlImport", "shareLimits", "sharePermissions", "shareAnalytics", "customBranding", "embeds",
      "fileRequests", "portals", "teams", "comments", "automations", "advancedAnalytics", "prioritySupport",
    ),
    limits: {
      storageBytes: 2 * TB,
      maxFileBytes: 50 * GB,
      transferBytesPerMonth: 5 * TB,
      apiRequestsPerMinute: 3_000,
      apiKeys: 50,
      webhooks: 25,
      webhookDeliveriesPerMonth: 500_000,
      automations: 100,
      automationRunsPerMonth: 100_000,
      versionsPerFile: 100,
      versionRetentionDays: UNLIMITED,
      trashRetentionDays: 90,
      maxRetentionDays: UNLIMITED,
      fileRequests: 100,
      organizations: 5,
      orgMembers: 100,
    },
    isPublic: true,
    isDefault: false,
    sortOrder: 2,
    highlights: [],
  },
];

/** Smallest chunk the browser may upload; kept here so plan editors can show sensible minimums. */
export const MIN_FILE_BYTES = 1 * MB;
