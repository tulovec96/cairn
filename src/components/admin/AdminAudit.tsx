"use client";

import { ScrollText } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { formatDateTime } from "@/lib/format";
import { useCursorList } from "./useCursorList";

interface Entry {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const GROUPS = [
  ["", "All events"],
  ["auth.", "Sign-in & account"],
  ["apikey.", "API keys"],
  ["file.", "Files"],
  ["folder.", "Folders"],
  ["share.", "Shares"],
  ["report.", "Reports"],
  ["admin.", "Administrative actions"],
];

export function AdminAudit() {
  const sp = useSearchParams();
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState(sp.get("actorId") ?? "");
  const [debounced, setDebounced] = useState(actorId);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(actorId.trim()), 300);
    return () => clearTimeout(t);
  }, [actorId]);
  const list = useCursorList<Entry>("/api/v1/admin/audit", { action: action || undefined, actorId: debounced || undefined, limit: 50 });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Event type" className="h-9 w-auto" value={action} onChange={(e) => setAction(e.target.value)}>
          {GROUPS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <div className="min-w-56 flex-1 sm:max-w-xs">
          <label htmlFor="audit-actor" className="sr-only">
            Filter by user or target id
          </label>
          <Input id="audit-actor" value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="Filter by user / target id" />
        </div>
      </div>
      {list.error && <ErrorNotice className="mb-3">{list.error}</ErrorNotice>}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {!list.items ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : list.items.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="No events" description="Security-relevant actions are recorded here. Passwords, tokens, API keys and file contents are never logged." />
        ) : (
          <div role="region" aria-label="Audit log" tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-[13px]">
              <thead className="border-b border-line text-xs text-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.items.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="px-4 py-2 whitespace-nowrap text-muted">{formatDateTime(e.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className="text-muted">{e.actorType}</span>
                      {e.actorId && <div className="font-mono text-[11px] break-all">{e.actorId}</div>}
                      {e.ip && <div className="text-muted">{e.ip}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {e.targetType && <span className="text-muted">{e.targetType}</span>}
                      {e.targetId && <div className="font-mono text-[11px] break-all">{e.targetId}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{e.metadata ? Object.entries(e.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.hasMore && (
          <div className="flex justify-center border-t border-line p-3">
            <Button onClick={list.loadMore} loading={list.loadingMore}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
