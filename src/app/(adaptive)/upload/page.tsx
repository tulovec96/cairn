import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";
import { HomeUploader } from "@/components/upload/HomeUploader";
import { requirePageUser } from "@/server/page-auth";
import { buildAuthedConfig } from "@/server/services/config";
import { listAllFolders } from "@/server/services/folders";
import { scopeOf } from "@/server/services/actor";

export const metadata: Metadata = { title: "Upload" };

export default async function UploadPage() {
  const actor = await requirePageUser();
  const [config, folders] = await Promise.all([buildAuthedConfig(actor), listAllFolders(scopeOf(actor))]);
  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Upload" description="Choose files or drop them below. Each upload can get its own expiry, password and download limit." />
        <HomeUploader config={config} folders={folders} />
      </div>
    </PageContainer>
  );
}