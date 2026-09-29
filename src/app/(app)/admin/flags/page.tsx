import type { Metadata } from "next";
import { AdminFlags } from "@/components/admin/AdminSystem";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Feature flags · Administration" };

export default function AdminFlagsPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Feature flags" description="Switch whole capabilities on or off." />
      <AdminFlags />
    </PageContainer>
  );
}