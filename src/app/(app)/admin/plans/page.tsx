import type { Metadata } from "next";
import { AdminPlans } from "@/components/admin/AdminWorkspace";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Plans · Administration" };

export default function AdminPlansPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Plans" description="Prices, features and limits. Everything the product enforces comes from here." />
      <AdminPlans />
    </PageContainer>
  );
}