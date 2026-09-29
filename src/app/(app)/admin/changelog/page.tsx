import type { Metadata } from "next";
import { AdminChangelog } from "@/components/admin/AdminContent";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Changelog · Administration" };

export default function AdminChangelogPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Changelog" description="What you tell the world has changed." />
      <AdminChangelog />
    </PageContainer>
  );
}