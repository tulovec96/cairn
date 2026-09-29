import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFiles } from "@/components/admin/AdminFiles";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Files · Administration" };

export default function AdminFilesPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Files" description="Search every upload. Inspect metadata and scan state, quarantine, release or delete. File contents are not exposed." />
      <Suspense>
        <AdminFiles />
      </Suspense>
    </PageContainer>
  );
}
