import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/AppShell";
import { TrashBrowser } from "@/components/files/TrashBrowser";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";
import { entitlementsForActor } from "@/server/services/limits";

export const metadata: Metadata = { title: "Trash" };

export default async function TrashPage() {
  const ent = await entitlementsForActor(await requirePageUser());
  return (
    <PageContainer wide>
      <PageHeader title="Trash" />
      <TrashBrowser retentionDays={ent.limits.trashRetentionDays} />
    </PageContainer>
  );
}
