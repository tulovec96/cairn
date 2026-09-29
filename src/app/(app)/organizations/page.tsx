import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/AppShell";
import { OrganizationsList } from "@/components/org/OrganizationsList";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrganizationsPage() {
  await requirePageUser();
  return (
    <PageContainer>
      <PageHeader title="Organizations" description="Shared workspaces for teams." />
      <OrganizationsList />
    </PageContainer>
  );
}
