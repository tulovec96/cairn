import { db } from "../db";
import { newId } from "../ids";

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.password_changed"
  | "auth.session_revoked"
  | "auth.account_deleted"
  | "apikey.created"
  | "apikey.revoked"
  | "file.uploaded"
  | "file.deleted"
  | "file.restored"
  | "file.purged"
  | "file.renamed"
  | "file.moved"
  | "file.expired"
  | "file.quarantined"
  | "file.released"
  | "file.scan_infected"
  | "folder.created"
  | "folder.deleted"
  | "share.created"
  | "share.updated"
  | "share.revoked"
  | "share.deleted"
  | "report.created"
  | "admin.user_suspended"
  | "admin.user_restored"
  | "admin.user_deleted"
  | "admin.user_sessions_revoked"
  | "admin.user_limits_changed"
  | "admin.file_quarantined"
  | "admin.file_released"
  | "admin.file_deleted"
  | "admin.report_resolved"
  | "admin.settings_updated"
  | "admin.role_changed"
  | "admin.quarantine_confirmed"
  | "admin.plan_changed"
  | "admin.plan_updated"
  | "admin.flag_changed"
  | "admin.org_suspended"
  | "admin.share_revoked"
  | "admin.ticket_replied"
  | "admin.incident_changed"
  | "admin.changelog_changed"
  | "admin.backup_created"
  | "auth.2fa_enabled"
  | "auth.2fa_disabled"
  | "auth.backup_codes_regenerated"
  | "auth.password_reset"
  | "auth.email_verified"
  | "auth.email_changed"
  | "auth.sessions_revoked_all"
  | "file.version_restored"
  | "file.copied"
  | "file.tagged"
  | "file.imported"
  | "request.created"
  | "request.updated"
  | "request.closed"
  | "request.upload_received"
  | "webhook.created"
  | "webhook.updated"
  | "webhook.deleted"
  | "automation.created"
  | "automation.updated"
  | "automation.deleted"
  | "org.created"
  | "org.updated"
  | "org.deleted"
  | "org.member_invited"
  | "org.member_joined"
  | "org.member_removed"
  | "folder.member_added"
  | "folder.member_removed"
  | "org.member_role_changed"
  | "billing.subscription_changed"
  | "billing.subscription_canceled"
  | "export.requested"
  | "import.requested";

export interface AuditEntry {
  actorType: "user" | "external" | "admin" | "api_key" | "system";
  actorId?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

const SECRET_KEY = /pass|token|secret|key|authorization|cookie|hash/i;

export function scrubMetadata(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) continue;
    clean[k] = typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}…` : v;
  }
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

/** Best-effort: an audit failure must never fail the operation being audited. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        id: newId("aud"),
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ip: entry.ip ?? null,
        metadata: scrubMetadata(entry.metadata),
      },
    });
  } catch (err) {
    console.error("[audit] failed to write entry", entry.action, (err as Error).message);
  }
}
