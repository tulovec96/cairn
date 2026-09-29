/**
 * The feature matrix: every capability that a plan can switch on or off, and every numeric limit a plan
 * can set. This file is the single source of truth. Plans (src/config/plans.ts, editable in the admin
 * panel) are just values for these keys, and the server checks them through src/server/services/entitlements.ts.
 *
 * To add an entitlement: add it here, give each default plan a value, and enforce it with
 * `assertFeature` / `assertLimit` where the capability is used. The pricing page and the plan editor
 * pick it up automatically.
 */

export const UNLIMITED = -1;

export interface FeatureDef {
  label: string;
  description: string;
  group: "Storage & files" | "Sharing" | "Developers" | "Collaboration" | "Automation" | "Support";
}

export const FEATURES = {
  api: { label: "API access", description: "Use API keys to work with your files programmatically.", group: "Developers" },
  webhooks: { label: "Webhooks", description: "Send signed event notifications to your own services.", group: "Developers" },
  fileVersioning: { label: "File versions", description: "Keep previous versions of a file and restore them.", group: "Storage & files" },
  urlImport: { label: "Import from URL", description: "Fetch files from a web address straight into your storage.", group: "Storage & files" },
  shareLimits: { label: "Download & view limits", description: "Stop a link after a set number of downloads or views.", group: "Sharing" },
  sharePermissions: { label: "Advanced link permissions", description: "View-only links and IP allow-lists.", group: "Sharing" },
  shareAnalytics: { label: "Share analytics", description: "See views, downloads and traffic for each link over time.", group: "Sharing" },
  customBranding: { label: "Custom link branding", description: "Add your name, accent colour and message to share pages and portals.", group: "Sharing" },
  embeds: { label: "Embeds", description: "Embed images, video, audio and PDFs from a share link.", group: "Sharing" },
  fileRequests: { label: "File requests", description: "Collect files from other people without giving them an account.", group: "Collaboration" },
  portals: { label: "Upload portals", description: "Branded, reusable upload pages.", group: "Collaboration" },
  teams: { label: "Organizations", description: "Shared workspaces with members, roles and pooled storage.", group: "Collaboration" },
  comments: { label: "Comments", description: "Discuss files and folders with your team.", group: "Collaboration" },
  automations: { label: "Automations", description: "Rules that act on files automatically.", group: "Automation" },
  advancedAnalytics: { label: "Storage & transfer analytics", description: "Growth over time, transfer volume and popular files.", group: "Storage & files" },
  prioritySupport: { label: "Priority support", description: "Faster responses from the support team.", group: "Support" },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export type LimitUnit = "bytes" | "count" | "days" | "perMinute" | "perMonth";

export interface LimitDef {
  label: string;
  unit: LimitUnit;
  description: string;
  /** Shown on the pricing page in this order; false hides the row. */
  pricing?: boolean;
}

export const LIMITS = {
  storageBytes: { label: "Storage", unit: "bytes", description: "Total space for files, versions and trash.", pricing: true },
  maxFileBytes: { label: "Largest file", unit: "bytes", description: "Maximum size of a single upload.", pricing: true },
  transferBytesPerMonth: { label: "Monthly transfer", unit: "bytes", description: "Data downloaded through share links and the API per month.", pricing: true },
  apiRequestsPerMinute: { label: "API requests", unit: "perMinute", description: "Requests per minute across all API keys.", pricing: true },
  apiKeys: { label: "API keys", unit: "count", description: "Active API keys." },
  webhooks: { label: "Webhooks", unit: "count", description: "Configured webhook endpoints.", pricing: true },
  webhookDeliveriesPerMonth: { label: "Webhook deliveries", unit: "perMonth", description: "Webhook calls per month." },
  automations: { label: "Automation rules", unit: "count", description: "Enabled automation rules.", pricing: true },
  automationRunsPerMonth: { label: "Automation runs", unit: "perMonth", description: "Rule executions per month." },
  versionsPerFile: { label: "Versions per file", unit: "count", description: "Previous versions kept for each file.", pricing: true },
  versionRetentionDays: { label: "Version retention", unit: "days", description: "How long old versions are kept." },
  trashRetentionDays: { label: "Trash retention", unit: "days", description: "How long deleted items can be restored.", pricing: true },
  maxRetentionDays: { label: "Longest file expiry", unit: "days", description: "Upper bound when a file is set to expire (unlimited = no bound)." },
  fileRequests: { label: "Open file requests", unit: "count", description: "File requests that can be open at once.", pricing: true },
  organizations: { label: "Organizations you can create", unit: "count", description: "Shared workspaces you own." },
  orgMembers: { label: "Members per organization", unit: "count", description: "People in a shared workspace." },
} as const satisfies Record<string, LimitDef>;

export type LimitKey = keyof typeof LIMITS;
export const LIMIT_KEYS = Object.keys(LIMITS) as LimitKey[];

export type PlanFeatures = Record<FeatureKey, boolean>;
export type PlanLimits = Record<LimitKey, number>;

export function emptyFeatures(value = false): PlanFeatures {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, value])) as PlanFeatures;
}

export function isUnlimited(n: number): boolean {
  return n < 0;
}

/** Human-readable value for a limit, used by the pricing page, billing page and plan editor. */
export function formatLimit(key: LimitKey, value: number): string {
  if (isUnlimited(value)) return "Unlimited";
  switch (LIMITS[key].unit) {
    case "bytes": {
      const units = ["B", "KB", "MB", "GB", "TB", "PB"];
      let n = value;
      let i = 0;
      while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
      }
      return `${Number(n.toFixed(n >= 100 ? 0 : 1))} ${units[i]}`;
    }
    case "days":
      return value === 0 ? "None" : `${value} days`;
    case "perMinute":
      return `${value.toLocaleString("en-US")} / min`;
    case "perMonth":
      return `${value.toLocaleString("en-US")} / month`;
    default:
      return value.toLocaleString("en-US");
  }
}
