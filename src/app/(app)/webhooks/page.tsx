import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";
import { WebhooksManager } from "@/components/webhooks/WebhooksManager";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  await requirePageUser();
  return (
    <PageContainer>
      <PageHeader title="Webhooks" description="Signed event notifications for your own services." />
      <WebhooksManager />
    </PageContainer>
  );
}
