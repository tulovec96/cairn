import type { Metadata } from "next";
import { SessionsManager } from "@/components/account/AccountForms";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Sessions" };

export default function SessionsPage() {
  return (
    <PageContainer>
      <PageHeader title="Sessions" description="Browsers and devices currently signed in to your account. Sign out any you don't recognize." />
      <SessionsManager />
    </PageContainer>
  );
}
