"use client";

import { Archive, ArchiveRestore, CalendarClock, Copy, Download, ExternalLink, FolderInput, Link2, Pencil, RotateCcw, Star, StarOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useCan } from "@/components/layout/AccountContext";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Badge, ErrorNotice, Spinner } from "@/components/ui/Feedback";
import { FileIcon } from "@/components/ui/FileIcon";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { ScanBadge } from "@/components/share/Bits";
import { FilePreview } from "@/components/share/FilePreview";
import { api, errorMessage, shareLink } from "@/lib/api-client";
import { formatBytes, formatDateTime, formatDuration, pluralize, timeAgo, timeUntil } from "@/lib/format";
import type { Breadcrumb, FileDto, ShareDto } from "@/lib/types";
import { ActivityTab } from "./panel/ActivityTab";
import { CommentsTab } from "./panel/CommentsTab";
import { MetadataForm } from "./panel/MetadataForm";
import { TagEditor } from "./panel/TagEditor";
import { VersionsTab } from "./panel/VersionsTab";
import type { FileActions } from "./useFileActions";

interface Details {
  file: FileDto;
  path: Breadcrumb[];
  shares: ShareDto[];
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2 text-[13px]">
      <dt className="text-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

interface Props {
  fileId: string;
  actions: FileActions;
  /** Bumps when the parent list changed, so the panel reloads. */
  refreshKey: number;
  onChanged: () => void;
  previewMaxText?: number;
}

type Tab = "overview" | "details" | "versions" | "comments" | "activity";

export function FileDetailsPanel({ fileId, actions, refreshKey, onChanged, previewMaxText }: Props) {
  const toast = useToast();
  const canWrite = useCan("write");
  const canDelete = useCan("delete");
  const canShare = useCan("share");
  const [data, setData] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [localKey, setLocalKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<Details>(`/api/v1/files/${fileId}`).then(
      (d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      },
      (e) => !cancelled && setError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [fileId, refreshKey, localKey]);

  if (error) return <div className="p-4"><ErrorNotice>{error}</ErrorNotice></div>;
  if (!data) return <div className="flex justify-center py-16"><Spinner /></div>;

  const { file, path } = data;
  const item = { kind: "file" as const, file };
  const ready = file.status === "available";
  const active = data.shares.find((s) => s.state === "active") ?? null;
  const folderName = path.length > 1 ? path.map((p) => p.name).join(" / ") : "All files";
  const parentId = path.length > 1 ? path[path.length - 1].id : null;
  const changed = () => {
    setLocalKey((k) => k + 1);
    onChanged();
  };

  const restore = async () => {
    try {
      await api(`/api/v1/files/${file.id}/restore`, { method: "POST", body: {} });
      toast.success("Restored");
      changed();
    } catch (err) {
      toast.error("Couldn't restore", errorMessage(err));
    }
  };
  const duplicate = async () => {
    try {
      await api(`/api/v1/files/${file.id}/copy`, { method: "POST", body: {} });
      toast.success("Duplicate created");
      changed();
    } catch (err) {
      toast.error("Couldn't duplicate", errorMessage(err));
    }
  };
  const archive = async () => {
    try {
      await api(`/api/v1/files/${file.id}`, { method: "PATCH", body: { archived: !file.archivedAt } });
      toast.success(file.archivedAt ? "Moved out of the archive" : "Archived");
      changed();
    } catch (err) {
      toast.error("Couldn't change the archive", errorMessage(err));
    }
  };

  const overview = (
    <div className="space-y-4">
      {file.previewKind && ready && !file.deletedAt && (
        <FilePreview src={`/api/v1/files/${file.id}/preview`} kind={file.previewKind} name={file.name} size={file.size} extension={file.extension} mediaInfo={file.mediaInfo} maxTextBytes={previewMaxText} />
      )}

      {active && (
        <div className="rounded-lg border border-line p-3">
          <p className="mb-1.5 text-xs font-medium text-subtle">Public link</p>
          <div className="flex items-center gap-2">
            <input readOnly aria-label="Share link" value={shareLink(active.token)} onFocus={(e) => e.currentTarget.select()} className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-2.5 font-mono text-xs" />
            <CopyButton value={() => shareLink(active.token)} iconOnly label="Copy link" />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {active.hasPassword ? "Password protected · " : ""}
            {!active.permissions.includes("download") ? "View only · " : ""}
            {active.expiresAt ? timeUntil(active.expiresAt) : "Link doesn't expire"}
            {active.maxDownloads ? ` · ${active.maxDownloads - active.downloadCount} downloads left` : ""}
            {active.maxViews ? ` · ${Math.max(0, active.maxViews - active.viewCount)} views left` : ""}
          </p>
        </div>
      )}

      <dl className="divide-y divide-line border-t border-line">
        <Row label="Location">
          <Link href={parentId ? `/files?folder=${parentId}` : "/files"} className="text-accent hover:underline">
            {folderName}
          </Link>
        </Row>
        <Row label="Uploaded">{formatDateTime(file.createdAt)}</Row>
        <Row label="Modified">{formatDateTime(file.updatedAt)}</Row>
        <Row label="Last opened">{file.lastAccessedAt ? timeAgo(file.lastAccessedAt) : "Never"}</Row>
        <Row label="Expires">{file.expiresAt ? `${formatDateTime(file.expiresAt)} (${timeUntil(file.expiresAt).toLowerCase()})` : "Never"}</Row>
        <Row label="Downloads">
          <span className="tnum">{file.downloadCount.toLocaleString("en-US")}</span>
          {file.lastDownloadAt ? <span className="text-muted"> · last {timeAgo(file.lastDownloadAt)}</span> : null}
        </Row>
        {file.mediaInfo?.width && file.mediaInfo?.height ? (
          <Row label="Dimensions">
            <span className="tnum">{file.mediaInfo.width} × {file.mediaInfo.height} px</span>
          </Row>
        ) : null}
        {file.mediaInfo?.duration ? <Row label="Duration">{formatDuration(file.mediaInfo.duration)}</Row> : null}
        <Row label="Security scan">
          <ScanBadge scanStatus={file.scanStatus} status={file.status} />
        </Row>
        <Row label="Links">{data.shares.length ? pluralize(data.shares.filter((s) => s.state === "active").length, "active link") + (data.shares.length > 1 ? ` (${data.shares.length} total)` : "") : "None"}</Row>
        {file.owner && <Row label="Owner">{file.owner.name}</Row>}
        <Row label="Version">{file.version}</Row>
        <Row label="SHA-256">
          <span className="flex items-start gap-1.5">
            <code className="min-w-0 flex-1 font-mono text-xs break-all text-muted">{file.sha256}</code>
            <CopyButton value={file.sha256} iconOnly label="Copy SHA-256" successMessage="Checksum copied" />
          </span>
        </Row>
        <Row label="File type">
          <span className="font-mono text-xs">{file.mime}</span>
          {file.extension ? <span className="text-muted"> · .{file.extension}</span> : null}
        </Row>
      </dl>
      <p className="flex items-center gap-1.5 text-xs text-subtle">
        <Copy className="size-3.5" aria-hidden /> The type is detected from the file&apos;s contents, not its name.
      </p>
    </div>
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-3">
        <FileIcon category={file.category} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold break-words">
            {file.colorLabel && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: file.colorLabel }} />}
            {file.name}
          </h2>
          <p className="mt-0.5 text-xs text-muted tnum">
            {formatBytes(file.size)} · {file.mime}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {file.favorite && <Badge tone="warning">Favorite</Badge>}
            {active ? <Badge tone="accent">Shared</Badge> : <Badge>Private</Badge>}
            {file.archivedAt && <Badge>Archived</Badge>}
            {file.status === "quarantined" && <Badge tone="danger">Blocked</Badge>}
            {file.tags.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-line px-2 text-[11px] leading-5 text-muted">
                <span aria-hidden className="size-1.5 rounded-full" style={{ background: t.color }} />
                {t.name}
              </span>
            ))}
          </div>
        </div>
        <Link href={`/file/${file.id}`} aria-label="Open on its own page" className="inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg">
          <ExternalLink className="size-4" aria-hidden />
        </Link>
      </div>

      {file.deletedAt && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning">
          <span>This file is in the trash.</span>
          <Button size="sm" onClick={restore} icon={<RotateCcw className="size-3.5" aria-hidden />}>
            Restore
          </Button>
        </div>
      )}
      {file.status === "quarantined" && <ErrorNotice>{file.quarantineNote ?? "This file was blocked by a security check."} It can&apos;t be downloaded or shared.</ErrorNotice>}

      {!file.deletedAt && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" disabled={!ready} onClick={() => actions.download([item])} icon={<Download className="size-4" aria-hidden />}>
            Download
          </Button>
          {canShare && (
            <Button size="sm" disabled={file.status === "quarantined"} onClick={() => actions.share(item)} icon={<Link2 className="size-4" aria-hidden />}>
              {active ? "Sharing" : "Share"}
            </Button>
          )}
          {canWrite && (
            <>
              <Button size="sm" onClick={() => actions.rename(item)} icon={<Pencil className="size-4" aria-hidden />}>
                Rename
              </Button>
              <Button size="sm" onClick={() => actions.move([item])} icon={<FolderInput className="size-4" aria-hidden />}>
                Move
              </Button>
              <Button size="sm" disabled={!ready} onClick={() => void duplicate()} icon={<Copy className="size-4" aria-hidden />}>
                Duplicate
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => void actions.setFavorite([item], !file.favorite)} icon={file.favorite ? <StarOff className="size-4" aria-hidden /> : <Star className="size-4" aria-hidden />}>
            {file.favorite ? "Unfavorite" : "Favorite"}
          </Button>
          {canWrite && (
            <>
              <Button size="sm" onClick={() => actions.expiry([item])} icon={<CalendarClock className="size-4" aria-hidden />}>
                Expiration
              </Button>
              <Button size="sm" onClick={() => void archive()} icon={file.archivedAt ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}>
                {file.archivedAt ? "Unarchive" : "Archive"}
              </Button>
            </>
          )}
          {canDelete && (
            <Button size="sm" variant="danger-outline" onClick={() => void actions.remove([item])} icon={<Trash2 className="size-4" aria-hidden />}>
              Trash
            </Button>
          )}
        </div>
      )}

      <Tabs
        label="File sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "details", label: "Details" },
          { value: "versions", label: "Versions", badge: file.versionCount > 1 ? <span className="rounded-full bg-surface-3 px-1.5 text-[10px] tnum">{file.versionCount}</span> : undefined },
          { value: "comments", label: "Comments", badge: file.commentCount ? <span className="rounded-full bg-surface-3 px-1.5 text-[10px] tnum">{file.commentCount}</span> : undefined },
          { value: "activity", label: "Activity" },
        ]}
      >
        {tab === "overview" && overview}
        {tab === "details" && (
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-[13px] font-semibold">Tags</h3>
              <TagEditor fileId={file.id} tags={file.tags} onChanged={changed} readOnly={!canWrite} />
            </div>
            <MetadataForm key={`${file.id}-${file.updatedAt}`} file={file} onChanged={changed} readOnly={!canWrite} />
          </div>
        )}
        {tab === "versions" && <VersionsTab fileId={file.id} fileName={file.name} onChanged={changed} />}
        {tab === "comments" && <CommentsTab fileId={file.id} />}
        {tab === "activity" && <ActivityTab fileId={file.id} />}
      </Tabs>
    </div>
  );
}
