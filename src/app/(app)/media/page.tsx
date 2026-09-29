import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/AppShell";
import { MediaLibrary } from "@/components/media/MediaLibrary";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Media" };

export default async function MediaPage() {
  await requirePageUser();
  return (
    <PageContainer wide>
      <PageHeader title="Media" description="Every photo, video and audio file across all your folders." />
      <MediaLibrary />
    </PageContainer>
  );
}
