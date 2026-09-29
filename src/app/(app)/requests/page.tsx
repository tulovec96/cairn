import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/AppShell";
import { RequestsManager } from "@/components/request/RequestsManager";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "File requests" };

export default async function RequestsPage() {
  await requirePageUser();
  return (
    <PageContainer>
      <PageHeader title="File requests" description="Get files from people without giving them an account." />
      <RequestsManager />
    </PageContainer>
  );
}
