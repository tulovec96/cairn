import type { Metadata } from "next";
import { AdminHealth } from "@/components/admin/AdminSystem";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Health · Administration" };

export default function AdminHealthPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Health" description="Live checks of the dependencies this installation relies on." />
      <AdminHealth />
    </PageContainer>
  );
}