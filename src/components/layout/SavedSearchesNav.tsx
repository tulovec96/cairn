"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { api } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";
import { cn } from "@/lib/cn";
import type { SavedSearchDto } from "@/server/services/library";

export const SAVED_SEARCHES_EVENT = "cairn:saved-searches";
export const notifySavedSearchesChanged = () => window.dispatchEvent(new Event(SAVED_SEARCHES_EVENT));

/** Saved searches, pinned first, as one-click sidebar links. */
export function SavedSearchesNav({ touch, onNavigate }: { touch?: boolean; onNavigate?: () => void }) {
  const res = useResource<{ items: SavedSearchDto[] }>("saved-searches", (signal) => api("/api/v1/saved-searches", { signal }));
  const { reload } = res;
  useEffect(() => {
    window.addEventListener(SAVED_SEARCHES_EVENT, reload);
    return () => window.removeEventListener(SAVED_SEARCHES_EVENT, reload);
  }, [reload]);
  const items = res.data?.items ?? [];
  if (!items.length) return null;
  return (
    <div>
      <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-sidebar-muted uppercase">Saved searches</p>
      <ul className="space-y-0.5">
        {items.slice(0, 12).map((s) => (
          <li key={s.id}>
            <Link
              href={`/files?q=${encodeURIComponent(s.query)}`}
              onClick={onNavigate}
              title={s.query}
              className={cn("flex items-center gap-3 rounded-md px-2.5 font-medium text-sidebar-fg transition-colors hover:bg-sidebar-hover hover:text-white", touch ? "h-11 text-sm" : "h-8 text-[13px]")}
            >
              <Search className="size-[15px] shrink-0 text-sidebar-muted" aria-hidden />
              <span className="truncate">{s.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}