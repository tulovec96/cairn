import type { Metadata } from "next";
import { AdminOrgs } from "@/components/admin/AdminWorkspace";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Organizations · Administration" };

export default function AdminOrgsPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Organizations" description="Shared workspaces, their storage and plans." />
      <AdminOrgs />
    </PageContainer>
  );
}