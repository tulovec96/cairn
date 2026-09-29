import type { Metadata } from "next";
import { NotificationsList } from "@/components/account/NotificationsList";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <PageContainer>
      <PageHeader title="Notifications" description="Upload problems, expiring files, storage warnings and security events." />
      <NotificationsList />
    </PageContainer>
  );
}
