import type { Metadata } from "next";
import { AutomationsManager } from "@/components/automation/AutomationsManager";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage() {
  await requirePageUser();
  return (
    <PageContainer>
      <PageHeader title="Automations" description="Rules that organize your files for you." />
      <AutomationsManager />
    </PageContainer>
  );
}
