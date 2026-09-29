import type { Metadata } from "next";
import { Suspense } from "react";
import { SharedWithMe } from "@/components/files/SharedWithMe";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Shared with me" };

export default async function SharedWithMePage() {
  await requirePageUser();
  return (
    <PageContainer wide>
      <PageHeader title="Shared with me" description="Folders other people have shared with your account. You can view and download; only the owner can change them." />
      <Suspense>
        <SharedWithMe />
      </Suspense>
    </PageContainer>
  );
}
