import type { Metadata } from "next";
import { AdminIncidents } from "@/components/admin/AdminContent";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Status incidents · Administration" };

export default function AdminIncidentsPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Status incidents" description="Incidents shown on the public status page." />
      <AdminIncidents />
    </PageContainer>
  );
}