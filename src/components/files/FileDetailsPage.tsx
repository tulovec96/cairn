"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Card } from "@/components/ui/Feedback";
import type { LimitsDto } from "@/lib/types";
import { FileDetailsPanel } from "./FileDetailsPanel";
import { useFileActions } from "./useFileActions";

/** Full-page version of the details drawer, reachable at /file/{id}. */
export function FileDetailsPage({ fileId, limits, previewMaxText }: { fileId: string; limits: LimitsDto; previewMaxText: number }) {
  const router = useRouter();
  const [key, setKey] = useState(0);
  const onChanged = useCallback(() => setKey((k) => k + 1), []);
  const { actions, dialogs } = useFileActions({
    limits,
    currentFolderId: null,
    onChanged,
    onOpenFile: () => undefined,
    onOpenFolder: (id) => router.push(`/files?folder=${id}`),
  });
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Link href="/files" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Back to files
      </Link>
      <Card>
        <FileDetailsPanel fileId={fileId} actions={actions} refreshKey={key} onChanged={onChanged} previewMaxText={previewMaxText} />
      </Card>
      {dialogs}
    </div>
  );
}
