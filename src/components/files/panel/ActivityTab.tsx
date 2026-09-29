"use client";

import { ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { api } from "@/lib/api-client";
import { ACTIVITY_LABELS } from "@/lib/activity";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { ActivityDto } from "@/server/services/activity";

/** Who did what to this file, newest first. */
export function ActivityTab({ fileId }: { fileId: string }) {
  const res = useResource<{ items: ActivityDto[] }>(`activity-${fileId}`, (signal) => api(`/api/v1/files/${fileId}/activity`, { signal }));
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data) return <Skeleton className="h-24" />;
  if (!res.data.items.length) return <p className="text-[13px] text-muted">No activity recorded yet.</p>;
  return (
    <ol className="space-y-3 border-l border-line pl-4">
      {res.data.items.map((a) => (
        <li key={a.id} className="relative text-[13px]">
          <span aria-hidden className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-accent" />
          <p>
            <span className="font-medium">{a.actor ?? "Someone"}</span> <span className="text-muted">{(ACTIVITY_LABELS[a.action] ?? a.action).toLowerCase()}</span>
            {a.action === "renamed" && typeof a.metadata.from === "string" ? <span className="text-muted"> from “{a.metadata.from}”</span> : null}
          </p>
          <p className="text-xs text-subtle" title={formatDateTime(a.createdAt)}>
            {timeAgo(a.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}
