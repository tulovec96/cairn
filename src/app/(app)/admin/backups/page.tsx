import type { Metadata } from "next";
import { AdminBackups } from "@/components/admin/AdminSystem";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Backups · Administration" };

export default function AdminBackupsPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Backups" description="Database backups and their history." />
      <AdminBackups />
    </PageContainer>
  );
}