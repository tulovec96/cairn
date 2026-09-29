import type { Metadata } from "next";
import { AdminQuarantine } from "@/components/admin/AdminModeration";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Malware review · Administration" };

export default function AdminQuarantinePage() {
  return (
    <PageContainer wide>
      <PageHeader title="Malware review" description="Files blocked from download until a person decides what happens to them." />
      <AdminQuarantine />
    </PageContainer>
  );
}