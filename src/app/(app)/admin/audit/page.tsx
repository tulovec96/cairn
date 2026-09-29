import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminAudit } from "@/components/admin/AdminAudit";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Audit logs · Administration" };

export default function AdminAuditPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Audit logs" description="Security-relevant events: sign-ins, uploads, deletions, sharing, API keys and administrative actions." />
      <Suspense>
        <AdminAudit />
      </Suspense>
    </PageContainer>
  );
}
