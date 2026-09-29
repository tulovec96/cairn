"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Avatar, Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { formatBytes, formatDate, timeAgo } from "@/lib/format";
import type { UserDto } from "@/lib/types";
import { useCursorList } from "./useCursorList";

type Row = UserDto & { fileCount: number; usedBytes: number };

export function AdminUsers() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const list = useCursorList<Row>("/api/v1/admin/users", { q: debounced || undefined, status: status || undefined });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <label htmlFor="user-search" className="sr-only">
            Search users
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input id="user-search" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email, name or id" />
        </div>
        <label className="sr-only" htmlFor="user-status">
          Status
        </label>
        <Select id="user-status" className="h-9 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>
      {list.error && <ErrorNotice className="mb-3">{list.error}</ErrorNotice>}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {!list.items ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : list.items.length === 0 ? (
          <EmptyState icon={<Search />} title="No users found" description="Try a different search or filter." />
        ) : (
          <div role="region" aria-label="Users" tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-[13px]">
              <thead className="border-b border-line text-xs text-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Files</th>
                  <th className="px-3 py-2 font-medium">Storage</th>
                  <th className="px-3 py-2 font-medium">Joined</th>
                  <th className="px-3 py-2 font-medium">Last sign-in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.items.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/users/${u.id}`} className="flex items-center gap-3">
                        <Avatar name={u.displayName} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg hover:underline">{u.displayName}</span>
                          <span className="block truncate text-xs text-muted">{u.email}</span>
                        </span>
                        {u.role === "admin" && <Badge tone="accent">Admin</Badge>}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{u.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>}</td>
                    <td className="px-3 py-2.5 tnum">{u.fileCount.toLocaleString("en-US")}</td>
                    <td className="px-3 py-2.5 tnum">{formatBytes(u.usedBytes)}</td>
                    <td className="px-3 py-2.5 text-muted">{formatDate(u.createdAt)}</td>
                    <td className="px-3 py-2.5 text-muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never"}</td>
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
