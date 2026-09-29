import type { Metadata } from "next";
import { AdminShares } from "@/components/admin/AdminWorkspace";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Shares · Administration" };

export default function AdminSharesPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Shares" description="Every public link. Revoke a link to stop abuse." />
      <AdminShares />
    </PageContainer>
  );
}