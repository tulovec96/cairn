import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/AppShell";
import { SharesManager } from "@/components/files/SharesManager";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Shared" };

export default function SharedPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Shared" description="Every public link you've created. Change passwords, expiry and download limits, or revoke a link at any time." />
      <SharesManager />
    </PageContainer>
  );
}
