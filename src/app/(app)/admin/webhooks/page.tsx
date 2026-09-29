import type { Metadata } from "next";
import { AdminWebhooks } from "@/components/admin/AdminSystem";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Webhooks · Administration" };

export default function AdminWebhooksPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Webhooks" description="Every webhook endpoint configured by users and organizations." />
      <AdminWebhooks />
    </PageContainer>
  );
}