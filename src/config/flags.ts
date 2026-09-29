/**
 * Feature flags: coarse on/off switches an administrator can flip at runtime (no rebuild). They sit
 * above plans: a flag that is off disables the capability for everyone, whatever their plan.
 */
export const FLAGS = {
  registration: { label: "New registrations", description: "Let new people create accounts." },
  sharing: { label: "Public share links", description: "Create and open share links." },
  fileRequests: { label: "File requests & portals", description: "Controlled upload pages for outside contributors." },
  api: { label: "Public API", description: "API keys and the /api/v1 endpoints." },
  webhooks: { label: "Webhooks", description: "Outbound webhook deliveries." },
  automations: { label: "Automations", description: "Rules that run when files change." },
  organizations: { label: "Organizations", description: "Shared workspaces." },
  comments: { label: "Comments", description: "Comments on files and folders." },
  urlImport: { label: "Import from URL", description: "Fetching files from web addresses." },
  billing: { label: "Billing & upgrades", description: "Self-service plan changes." },
  support: { label: "In-app support", description: "Help center contact form and tickets." },
} as const;

export type FlagKey = keyof typeof FLAGS;
export const FLAG_KEYS = Object.keys(FLAGS) as FlagKey[];
