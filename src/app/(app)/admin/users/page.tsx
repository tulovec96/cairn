import type { Metadata } from "next";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Users · Administration" };

export default function AdminUsersPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Users" description="Search accounts, inspect usage, suspend or delete them. Passwords are never shown." />
      <AdminUsers />
    </PageContainer>
  );
}
