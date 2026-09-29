import type { Metadata } from "next";
import { Suspense } from "react";
import { FileBrowser } from "@/components/files/FileBrowser";
import { requirePageUser } from "@/server/page-auth";
import { buildAuthedConfig } from "@/server/services/config";

export const metadata: Metadata = { title: "Files" };

export default async function FilesPage() {
  const actor = await requirePageUser();
  const config = await buildAuthedConfig(actor);
  return (
    <Suspense>
      <FileBrowser view="all" config={config} title="All files" />
    </Suspense>
  );
}
