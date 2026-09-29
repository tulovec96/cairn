import type { Metadata } from "next";
import { ApiKeysManager } from "@/components/api/ApiKeysManager";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "API keys" };

export default function ApiKeysPage() {
  return (
    <PageContainer>
      <PageHeader title="API keys" description="Keys act as you, limited to the permissions you choose. The full key is only shown once, when you create it." />
      <ApiKeysManager />
    </PageContainer>
  );
}
