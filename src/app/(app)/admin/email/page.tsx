import type { Metadata } from "next";
import { AdminEmail } from "@/components/admin/AdminSystem";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Email outbox · Administration" };

export default function AdminEmailPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Email outbox" description="Every message the platform has tried to send." />
      <AdminEmail />
    </PageContainer>
  );
}