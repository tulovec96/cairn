"use client";

import { Bell, BellOff, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Pop } from "@/components/ui/Overlays";
import { Spinner } from "@/components/ui/Feedback";
import { api } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import type { NotificationDto } from "@/lib/types";

interface Payload {
  items: NotificationDto[];
  unread: number;
}

export function NotificationsBell() {
  const res = useResource<Payload>("bell", (signal) => api<Payload>("/api/v1/notifications", { signal }));
  const data = res.data;
  const [loading, setLoading] = useState(false);
  const { reload } = res;
  const load = async () => reload();

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  const markAll = async () => {
    setLoading(true);
    try {
      res.mutate(await api<Payload>("/api/v1/notifications", { method: "POST", body: {} }));
    } finally {
      setLoading(false);
    }
  };

  const unread = data?.unread ?? 0;
  return (
    <Pop
      label="Notifications"
      className="w-[22rem] p-0"
      trigger={
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => void load()} className="relative">
          <Bell className="size-4" aria-hidden />
          {unread > 0 && (
            <span aria-hidden className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-4 font-semibold text-accent-fg tnum">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      }
    >
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold">Notifications</h2>
        <Button variant="ghost" size="sm" onClick={markAll} disabled={!unread || loading} icon={loading ? <Spinner /> : <Check className="size-3.5" aria-hidden />}>
          Mark all read
        </Button>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {!data ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : data.items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-10 text-center text-[13px] text-muted">
            <BellOff className="mb-2 size-5 text-subtle" aria-hidden />
            You&apos;re all caught up.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((n) => {
              const body = (
                <div className="flex gap-2.5">
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[13px]", n.readAt ? "text-muted" : "font-medium text-fg")}>{n.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p>
                    <p className="mt-1 text-[11px] text-subtle">{timeAgo(n.createdAt)}</p>
                  </div>
                </div>
              );
              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link
                      href={n.href}
                      className="block px-3.5 py-2.5 hover:bg-surface-2"
                      onClick={() => {
                        if (!n.readAt) void api("/api/v1/notifications", { method: "POST", body: { ids: [n.id] } }).then(load);
                      }}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="px-3.5 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="border-t border-line px-3.5 py-2 text-center">
        <Link href="/notifications" className="text-xs font-medium text-accent hover:underline">
          View all notifications
        </Link>
      </div>
    </Pop>
  );
}
