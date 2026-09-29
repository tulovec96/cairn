"use client";

import { Bell, Check, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { api, errorMessage } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import type { NotificationDto } from "@/lib/types";

interface Payload {
  items: NotificationDto[];
  unread: number;
}

export function NotificationsList() {
  const res = useResource<Payload>("notifications", (signal) => api<Payload>("/api/v1/notifications", { signal }));
  const [actionError, setActionError] = useState<string | null>(null);
  const data = res.data;
  const error = res.error ?? actionError;
  const setData = (p: Payload) => res.mutate(p);
  const run = async (fn: () => Promise<Payload>) => {
    try {
      setData(await fn());
      setActionError(null);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  return (
    <div>
      {error && <ErrorNotice className="mb-3">{error}</ErrorNotice>}
      <div className="mb-3 flex justify-end gap-2">
        <Button size="sm" disabled={!data?.unread} onClick={() => run(() => api<Payload>("/api/v1/notifications", { method: "POST", body: {} }))} icon={<Check className="size-4" aria-hidden />}>
          Mark all read
        </Button>
        <Button size="sm" variant="ghost" disabled={!data?.items.some((n) => n.readAt)} onClick={() => run(() => api<Payload>("/api/v1/notifications", { method: "DELETE" }))} icon={<Trash2 className="size-4" aria-hidden />}>
          Clear read
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {!data ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState icon={<Bell />} title="You're all caught up" description="We only notify you about things that need attention." />
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[13px]", n.readAt ? "text-muted" : "font-medium")}>{n.title}</p>
                  <p className="text-[13px] text-muted">{n.body}</p>
                  <p className="mt-0.5 text-xs text-subtle">{timeAgo(n.createdAt)}</p>
                </div>
                {n.href && (
                  <Link href={n.href} className="shrink-0 text-[13px] font-medium text-accent hover:underline">
                    View
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
