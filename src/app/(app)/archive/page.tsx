import type { Metadata } from "next";
import { Suspense } from "react";
import { FileBrowser } from "@/components/files/FileBrowser";
import { requirePageUser } from "@/server/page-auth";
import { buildAuthedConfig } from "@/server/services/config";

export const metadata: Metadata = { title: "Archive" };

export default async function ArchivePage() {
  const actor = await requirePageUser();
  const config = await buildAuthedConfig(actor);
  return (
    <Suspense>
      <FileBrowser view="archived" config={config} title="Archive" description="Files you set aside. They stay searchable and still count toward storage." />
    </Suspense>
  );
}
