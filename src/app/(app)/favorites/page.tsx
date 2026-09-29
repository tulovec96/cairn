import type { Metadata } from "next";
import { Suspense } from "react";
import { FileBrowser } from "@/components/files/FileBrowser";
import { requirePageUser } from "@/server/page-auth";
import { buildAuthedConfig } from "@/server/services/config";

export const metadata: Metadata = { title: "Favorites" };

export default async function FavoritesPage() {
  const actor = await requirePageUser();
  const config = await buildAuthedConfig(actor);
  return (
    <Suspense>
      <FileBrowser view="favorites" config={config} title="Favorites" description="Files and folders you starred." />
    </Suspense>
  );
}
