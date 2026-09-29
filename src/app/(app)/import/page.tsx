import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/AppShell";
import { ImportManager } from "@/components/library/ImportManager";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Import from URL" };

export default async function ImportPage() {
  await requirePageUser();
  return (
    <PageContainer>
      <PageHeader title="Import from URL" description="Bring a file in from the web without downloading it first." />
      <ImportManager />
    </PageContainer>
  );
}
