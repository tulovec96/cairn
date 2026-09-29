import type { Metadata } from "next";
import { Suspense } from "react";
import { FileBrowser } from "@/components/files/FileBrowser";
import { requirePageUser } from "@/server/page-auth";
import { buildAuthedConfig } from "@/server/services/config";

export const metadata: Metadata = { title: "Recent" };

export default async function RecentPage() {
  const actor = await requirePageUser();
  const config = await buildAuthedConfig(actor);
  return (
    <Suspense>
      <FileBrowser view="recent" config={config} title="Recent" description="The last 50 files you uploaded, changed, opened or shared." />
    </Suspense>
  );
}
