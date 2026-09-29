import type { Metadata } from "next";
import { FileDetailsPage } from "@/components/files/FileDetailsPage";
import { requirePageUser } from "@/server/page-auth";
import { limitsFor } from "@/server/services/limits";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "File details" };

export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, actor, settings] = await Promise.all([params, requirePageUser(), getSettings()]);
  return <FileDetailsPage fileId={id} limits={await limitsFor(actor)} previewMaxText={settings.files.previewTextMaxBytes} />;
}
