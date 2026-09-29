import type { Metadata } from "next";
import { AdminJobs } from "@/components/admin/AdminSystem";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Jobs · Administration" };

export default function AdminJobsPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Jobs" description="The background queue: scanning, thumbnails, webhooks, exports and more." />
      <AdminJobs />
    </PageContainer>
  );
}