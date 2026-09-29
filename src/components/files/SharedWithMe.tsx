"use client";

import { ChevronRight, Download, ExternalLink, FolderOpen, LogOut, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { FileIcon, FolderIcon } from "@/components/ui/FileIcon";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatBytes, formatDate } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { SharedFileDto, SharedFolderDto } from "@/server/services/sharedFolders";

interface Browse {
  rootId: string;
  ownerName: string;
  breadcrumbs: Array<{ id: string; name: string }>;
  folders: Array<{ id: string; name: string }>;
  files: SharedFileDto[];
}

function FileRow({ file }: { file: SharedFileDto }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      {file.hasThumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin thumbnail
        <img src={`/api/v1/shared-with-me/files/${file.id}/thumbnail?size=s`} alt="" loading="lazy" className="size-9 shrink-0 rounded-md border border-line object-cover" />
      ) : (
        <FileIcon category={file.category} size="md" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs text-muted tnum">
          {formatBytes(file.size)} · {formatDate(file.createdAt)}
        </p>
      </div>
      {file.previewKind && (
        <a href={`/api/v1/shared-with-me/files/${file.id}/preview`} target="_blank" rel="noreferrer noopener" aria-label={`Open ${file.name} in a new tab`} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
          <ExternalLink className="size-4" aria-hidden />
        </a>
      )}
      <a href={`/api/v1/shared-with-me/files/${file.id}/download`} download={file.name} aria-label={`Download ${file.name}`} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
        <Download className="size-4" aria-hidden />
      </a>
    </li>
  );
}

export function SharedWithMe() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const folder = params.get("folder");

  const list = useResource<{ items: SharedFolderDto[] }>("shared-with-me", (signal) => api<{ items: SharedFolderDto[] }>("/api/v1/shared-with-me", { signal }));
  const browse = useResource<Browse | null>(`shared-browse:${folder}`, (signal) => (folder ? api<Browse>(`/api/v1/shared-with-me/folders/${folder}`, { signal }) : Promise.resolve(null)));

  const leave = async (s: SharedFolderDto) => {
    if (!(await confirm({ title: `Stop seeing “${s.name}”?`, description: `You'll lose access to what ${s.ownerName} shared. They can share it with you again.`, confirmLabel: "Leave", tone: "danger" }))) return;
    try {
      await api(`/api/v1/folders/${s.folderId}/members/${s.membershipId}`, { method: "DELETE" });
      toast.success("You left the shared folder");
      list.reload();
      if (folder === s.folderId) router.replace("/shared-with-me");
    } catch (err) {
      toast.error("Couldn't leave", errorMessage(err));
    }
  };

  if (folder) {
    if (browse.error) {
      return (
        <div>
          <ErrorNotice>{browse.error}</ErrorNotice>
          <Link href="/shared-with-me" className="mt-3 inline-block text-[13px] font-medium text-accent hover:underline">
            Back to shared folders
          </Link>
        </div>
      );
    }
    if (!browse.data) return <Skeleton className="h-64" />;
    const b = browse.data;
    const membership = list.data?.items.find((s) => s.folderId === b.rootId);
    return (
      <div>
        <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-[13px]">
          <Link href="/shared-with-me" className="text-muted hover:text-fg hover:underline">
            Shared with me
          </Link>
          {b.breadcrumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-subtle" aria-hidden />
              {i === b.breadcrumbs.length - 1 ? (
                <span aria-current="page" className="font-semibold">
                  {c.name}
                </span>
              ) : (
                <Link href={`/shared-with-me?folder=${c.id}`} className="text-muted hover:text-fg hover:underline">
                  {c.name}
                </Link>
              )}
            </span>
          ))}
          <span className="ml-2 text-xs text-subtle">shared by {b.ownerName}, view only</span>
          {membership && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => leave(membership)} icon={<LogOut className="size-4" aria-hidden />}>
              Leave
            </Button>
          )}
        </nav>
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          {b.folders.length === 0 && b.files.length === 0 ? (
            <EmptyState icon={<FolderOpen />} title="This folder is empty" description="Nothing has been added to it yet." />
          ) : (
            <ul className="divide-y divide-line">
              {b.folders.map((f) => (
                <li key={f.id}>
                  <Link href={`/shared-with-me?folder=${f.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <FolderIcon size="md" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{f.name}</span>
                    <ChevronRight className="size-4 text-subtle" aria-hidden />
                  </Link>
                </li>
              ))}
              {b.files.map((f) => (
                <FileRow key={f.id} file={f} />
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (list.error) return <ErrorNotice>{list.error}</ErrorNotice>;
  if (!list.data) return <Skeleton className="h-32" />;
  if (list.data.items.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <EmptyState icon={<Users />} title="Nothing has been shared with you" description="When someone shares a folder with your account, it shows up here. You'll get a notification too." />
      </div>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.data.items.map((s) => (
        <li key={s.membershipId} className="flex flex-col rounded-lg border border-line bg-surface p-4">
          <Link href={`/shared-with-me?folder=${s.folderId}`} className="flex items-start gap-3">
            <FolderIcon size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{s.name}</p>
              <p className="text-xs text-muted">
                from {s.ownerName} · shared {formatDate(s.sharedAt)}
              </p>
            </div>
          </Link>
          <div className="mt-3 flex gap-2">
            <Link href={`/shared-with-me?folder=${s.folderId}`} className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover">
              Open
            </Link>
            <Button size="sm" variant="ghost" onClick={() => leave(s)}>
              Leave
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
