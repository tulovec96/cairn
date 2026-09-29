import type { Metadata } from "next";
import { AdminSettings } from "@/components/admin/AdminSettings";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "System settings · Administration" };

export default function AdminSettingsPage() {
  return (
    <PageContainer wide>
      <PageHeader title="System settings" description="Limits, retention, scanning, rate limits and maintenance mode. Changes apply immediately." />
      <AdminSettings />
    </PageContainer>
  );
}
