import { t, type MessageKey } from "@/i18n";

const KEYS = ["uploaded", "downloaded", "renamed", "moved", "copied", "deleted", "restored", "version_created", "version_restored", "tagged", "quarantined", "created", "revoked", "upload_received"] as const;

/** Human wording for activity history entries (the part of the event type after the dot). */
export const ACTIVITY_LABELS: Record<string, string> = Object.fromEntries(KEYS.map((k) => [k, t(`activity.${k}` as MessageKey)]));