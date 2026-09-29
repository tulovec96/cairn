"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";

export function RetryJobsButton({ failed }: { failed: number }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      loading={busy}
      disabled={failed === 0}
      icon={<RotateCw className="size-3.5" aria-hidden />}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ requeued: number }>("/api/v1/admin/jobs/retry", { method: "POST", body: {} });
          toast.success(`Re-queued ${r.requeued} failed jobs`);
          router.refresh();
        } catch (err) {
          toast.error("Couldn't retry jobs", errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      Retry failed jobs
    </Button>
  );
}
