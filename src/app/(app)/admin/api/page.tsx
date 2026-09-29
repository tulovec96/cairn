import type { Metadata } from "next";
import { AdminApi } from "@/components/admin/AdminSystem";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "API · Administration" };

export default function AdminApiPage() {
  return (
    <PageContainer wide>
      <PageHeader title="API" description="Traffic across every API key on the platform." />
      <AdminApi />
    </PageContainer>
  );
}