import type { Metadata } from "next";
import { NotificationPrefs } from "@/components/account/NotificationPrefs";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";
import { emailStatus } from "@/server/services/email";
import { NOTIFICATION_TYPES, notificationPrefs } from "@/server/services/notifications";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationSettingsPage() {
  const actor = await requirePageUser();
  const prefs = notificationPrefs(actor.user.prefs);
  const rows = Object.entries(NOTIFICATION_TYPES).map(([type, d]) => ({ type, label: d.label, description: d.description, security: d.security }));
  return (
    <PageContainer>
      <PageHeader title="Notifications" description="Choose what you hear about, and where." />
      <NotificationPrefs rows={rows} initial={{ inApp: prefs.inApp as Record<string, boolean>, email: prefs.email as Record<string, boolean> }} emailConfigured={emailStatus().configured} />
    </PageContainer>
  );
}
