import type { Metadata } from "next";
import { AdminSubscriptions } from "@/components/admin/AdminWorkspace";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Subscriptions · Administration" };

export default function AdminSubscriptionsPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Subscriptions" description="Who is on which plan, and who manages it." />
      <AdminSubscriptions />
    </PageContainer>
  );
}