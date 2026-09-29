import type { Metadata } from "next";
import { BillingPanel } from "@/components/billing/BillingPanel";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Plan & billing" };

export default async function BillingPage() {
  const actor = await requirePageUser();
  return (
    <PageContainer wide>
      <PageHeader title="Plan & billing" description={actor.workspace.orgId ? `Plan for ${actor.workspace.orgName ?? "this organization"}.` : "Your plan, what it includes, and your billing history."} />
      <BillingPanel />
    </PageContainer>
  );
}
