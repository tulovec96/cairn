import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/AppShell";
import { SupportCenter } from "@/components/support/Support";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Support" };

export default async function SupportPage() {
  await requirePageUser();
  return (
    <PageContainer>
      <PageHeader title="Support" description="Your conversations with the team." />
      <SupportCenter />
    </PageContainer>
  );
}
