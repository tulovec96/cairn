import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/AppShell";
import { OrganizationDetail } from "@/components/org/OrganizationDetail";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Organization" };

export default async function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  return (
    <PageContainer>
      <PageHeader title="Organization" description="Members, roles and settings." />
      <OrganizationDetail orgId={id} />
    </PageContainer>
  );
}
