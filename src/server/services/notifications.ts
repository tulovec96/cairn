import { db } from "../db";
import { newId } from "../ids";
import type { NotificationDto } from "@/lib/types";

export const NOTIFICATION_TYPES = {
  upload_complete: { label: "Large uploads finish", description: "When an upload of 100 MB or more completes.", security: false },
  upload_failed: { label: "Upload problems", description: "When an upload can't be saved.", security: false },
  file_expired: { label: "Files expire", description: "When files reach their expiry date and are deleted.", security: false },
  storage_warning: { label: "Storage warnings", description: "When storage is nearly full.", security: false },
  share_revoked: { label: "Links revoked", description: "When a share link is revoked by the system or an administrator.", security: false },
  share_expiring: { label: "Links expiring soon", description: "A day before a share link expires.", security: false },
  file_quarantined: { label: "Files quarantined", description: "When a file is blocked by a scan or an administrator.", security: false },
  malware_detected: { label: "Malware detected", description: "When a scan finds malware in one of your files.", security: true },
  request_received: { label: "File request uploads", description: "When someone uploads through a file request or portal.", security: false },
  subscription_changed: { label: "Plan changes", description: "When your plan or billing state changes.", security: false },
  security_event: { label: "Security events", description: "New sign-ins, password changes and other account security changes.", security: true },
  comment_mention: { label: "Mentions", description: "When someone mentions you in a comment.", security: false },
  org_invite: { label: "Organization invites", description: "When you're invited to an organization.", security: false },
  folder_shared: { label: "Folders shared with you", description: "When someone shares a folder with you.", security: false },
  release: { label: "Product updates", description: "Important new features and changes.", security: false },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
  /** When set, an identical notification created in the last `dedupeHours` suppresses this one. */
  dedupeKey?: string;
  dedupeHours?: number;
}

export interface NotificationPrefs {
  inApp: Partial<Record<NotificationType, boolean>>;
  email: Partial<Record<NotificationType, boolean>>;
}

export function parsePrefs(raw: string | null | undefined): { notifications?: Partial<NotificationPrefs> } & Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function notificationPrefs(userPrefsJson: string | null | undefined): NotificationPrefs {
  const n = parsePrefs(userPrefsJson).notifications ?? {};
  return { inApp: n.inApp ?? {}, email: n.email ?? {} };
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    const def = NOTIFICATION_TYPES[input.type];
    const user = await db.user.findUnique({ where: { id: input.userId }, select: { prefs: true, email: true, status: true } });
    if (!user) return;
    const prefs = notificationPrefs(user.prefs);
    // Security notifications can't be switched off: people need to know when something risky happens.
    const inApp = def.security || prefs.inApp[input.type] !== false;
    if (input.dedupeKey) {
      const since = new Date(Date.now() - (input.dedupeHours ?? 24) * 3600_000);
      const existing = await db.notification.findFirst({ where: { userId: input.userId, dedupeKey: input.dedupeKey, createdAt: { gte: since } }, select: { id: true } });
      if (existing) return;
    }
    if (inApp) {
      await db.notification.create({
        data: {
          id: newId("ntf"),
          userId: input.userId,
          type: input.type,
          title: input.title.slice(0, 200),
          body: input.body.slice(0, 500),
          href: input.href ?? null,
          dedupeKey: input.dedupeKey ?? null,
        },
      });
    }
    if (def.security || prefs.email[input.type] === true) {
      const { queueEmail } = await import("./email");
      await queueEmail({ userId: input.userId, to: user.email, template: `notification.${input.type}`, subject: input.title, body: `${input.body}${input.href ? `\n\n${input.href}` : ""}` });
    }
  } catch (err) {
    console.error("[notify] failed", (err as Error).message);
  }
}

export async function listNotifications(userId: string, limit = 30): Promise<{ items: NotificationDto[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    unread,
    items: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      href: n.href,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<void> {
  await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}

export async function deleteReadNotifications(userId: string): Promise<void> {
  await db.notification.deleteMany({ where: { userId, readAt: { not: null } } });
}

export async function pruneNotifications(): Promise<void> {
  const cutoff = new Date(Date.now() - 90 * 86400_000);
  await db.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
