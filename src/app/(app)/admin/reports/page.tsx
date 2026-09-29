import type { Metadata } from "next";
import { AdminReports } from "@/components/admin/AdminReports";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Reports · Administration" };

export default function AdminReportsPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Abuse reports" description="Review reports from public download pages. Resolving can quarantine or delete the file." />
      <AdminReports />
    </PageContainer>
  );
}
