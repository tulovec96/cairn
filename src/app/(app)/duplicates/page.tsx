import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/AppShell";
import { DuplicatesManager } from "@/components/library/DuplicatesManager";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Duplicates" };

export default async function DuplicatesPage() {
  await requirePageUser();
  return (
    <PageContainer>
      <PageHeader title="Duplicates" description="Identical files taking up space twice." />
      <DuplicatesManager />
    </PageContainer>
  );
}
