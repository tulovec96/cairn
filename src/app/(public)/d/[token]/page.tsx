import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Download, Eye, Folder, Hash, HardDrive, Lock } from "lucide-react";
import { AutoRefresh, PasswordGate, ReportButton, ScanBadge } from "@/components/share/Bits";
import { FileIcon } from "@/components/ui/FileIcon";
import { CopyButton } from "@/components/ui/CopyButton";
import { CopyShareClient } from "@/components/share/CopyShareClient";
import { ButtonLink } from "@/components/ui/Button";
import { FolderShareList } from "@/components/share/FolderShareList";
import { FilePreview } from "@/components/share/FilePreview";
import { ViewBeacon } from "@/components/share/ViewBeacon";
import { EmptyState } from "@/components/ui/Feedback";
import { LinkOff } from "@/components/share/LinkOff";
import { ApiError } from "@/server/errors";
import { pageIp, pageRequest } from "@/server/page-auth";
import { describeShare } from "@/server/services/publicShares";
import { formatBytes, formatDateTime, timeUntil } from "@/lib/format";
import { getSettings } from "@/server/settings";
import type { PublicShareDto } from "@/lib/types";

export const metadata: Metadata = { title: "Shared file", robots: { index: false, follow: false } };

function Attribution({ share }: { share: PublicShareDto }) {
  if (!share.owner) return null;
  const brand = share.owner.brandName;
  return (
    <p className="mb-3 text-xs text-subtle">
      {brand ? <span className="font-medium text-muted">{brand}</span> : <>Shared by <span className="font-medium text-muted">{share.owner.name}</span></>}
    </p>
  );
}

function Message({ share }: { share: PublicShareDto }) {
  if (!share.message) return null;
  return <p className="mt-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] whitespace-pre-wrap text-muted">{share.message}</p>;
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let share: PublicShareDto;
  try {
    share = await describeShare(await pageRequest(), token, await pageIp());
  } catch (err) {
    if (err instanceof ApiError && [403, 404, 410].includes(err.status)) {
      return (
        <div className="mx-auto max-w-md">
          <EmptyState
            icon={<LinkOff />}
            title={err.status === 404 ? "This link doesn't exist" : err.status === 403 ? "This link can't be opened from here" : "This link is no longer available"}
            description={err.message}
            action={
              <ButtonLink href="/" variant="primary">
                Go to Cairn
              </ButtonLink>
            }
          />
        </div>
      );
    }
    throw err;
  }
  const settings = await getSettings();
  const maintenance = settings.maintenance.enabled && !settings.maintenance.allowDownloads;
  const canDownload = share.permissions.includes("download");

  if (share.requiresPassword && !share.unlocked) {
    return (
      <div className="mx-auto max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Lock className="size-5" aria-hidden />
        </div>
        <PasswordGate token={token} />
      </div>
    );
  }

  if (share.file) {
    const f = share.file;
    const ready = f.status === "available" && !maintenance;
    const inProgress = f.status === "scanning" || f.status === "processing";
    const previewSrc = `/dl/${token}?mode=preview`;
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <ViewBeacon token={token} />
        <AutoRefresh active={inProgress} />
        <div className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6" style={share.owner?.accent ? { borderTopColor: share.owner.accent, borderTopWidth: 3 } : undefined}>
          <Attribution share={share} />
          <div className="flex items-start gap-4">
            {f.hasThumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- generated thumbnail served by the app
              <img src={`/dl/${token}?mode=thumb`} alt="" className="size-14 shrink-0 rounded-lg border border-line object-cover" />
            ) : (
              <FileIcon category={f.category} size="lg" />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold tracking-tight break-words text-fg">{share.title ?? f.name}</h1>
              {share.title && <p className="text-[13px] break-words text-muted">{f.name}</p>}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                <span className="inline-flex items-center gap-1 tnum">
                  <HardDrive className="size-3.5" aria-hidden /> {formatBytes(f.size)}
                </span>
                <span>{f.mime}</span>
                <span>Uploaded {formatDateTime(f.createdAt, "UTC")} UTC</span>
              </p>
            </div>
          </div>
          <Message share={share} />

          <dl className="mt-5 grid gap-3 border-t border-line pt-4 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-xs text-subtle">Security</dt>
              <dd className="mt-1">
                <ScanBadge scanStatus={f.scanStatus} status={f.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Availability</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-fg">
                <CalendarClock className="size-4 text-subtle" aria-hidden />
                {f.expiresAt || share.shareExpiresAt ? `${timeUntil(share.shareExpiresAt ?? f.expiresAt)} · until ${formatDateTime(share.shareExpiresAt ?? f.expiresAt, "UTC")} UTC` : "Doesn't expire"}
              </dd>
            </div>
            {share.downloadsLeft !== null && canDownload && (
              <div>
                <dt className="text-xs text-subtle">Downloads left</dt>
                <dd className="mt-1 text-fg tnum">
                  {share.downloadsLeft} of {share.maxDownloads}
                </dd>
              </div>
            )}
            {f.mediaInfo?.width && f.mediaInfo?.height && (
              <div>
                <dt className="text-xs text-subtle">Dimensions</dt>
                <dd className="mt-1 text-fg tnum">
                  {f.mediaInfo.width} × {f.mediaInfo.height}
                </dd>
              </div>
            )}
            {f.sha256 && (
              <div className="sm:col-span-2">
                <dt className="flex items-center gap-1 text-xs text-subtle">
                  <Hash className="size-3.5" aria-hidden /> SHA-256
                </dt>
                <dd className="mt-1 flex items-start gap-2">
                  <code className="min-w-0 flex-1 font-mono text-xs break-all text-muted">{f.sha256}</code>
                  <CopyButton value={f.sha256} iconOnly label="Copy SHA-256" successMessage="Checksum copied" />
                </dd>
              </div>
            )}
          </dl>

          {maintenance && <p className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning">{settings.maintenance.message}</p>}
          {f.status === "quarantined" && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">This file was blocked by a security check and can&apos;t be downloaded.</p>}
          {inProgress && <p className="mt-4 rounded-md bg-accent-soft px-3 py-2 text-[13px] text-fg">The file is being scanned. The download will be available in a moment.</p>}
          {!canDownload && (
            <p className="mt-4 flex items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-[13px] text-fg">
              <Eye className="size-4 shrink-0 text-accent" aria-hidden /> The owner shared this file for viewing only. Downloading is turned off.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {canDownload &&
              (ready ? (
                <ButtonLink href={`/dl/${token}`} variant="primary" size="lg" icon={<Download className="size-4" aria-hidden />} prefetch={false} download>
                  Download
                </ButtonLink>
              ) : (
                <span aria-disabled className="inline-flex h-11 items-center gap-2 rounded-md bg-surface-3 px-5 text-sm font-medium text-subtle">
                  <Download className="size-4" aria-hidden /> Download unavailable
                </span>
              ))}
            <CopyShareClient token={token} />
            <span className="ml-auto">
              <ReportButton token={token} />
            </span>
          </div>
        </div>

        {f.previewKind && ready && <FilePreview src={previewSrc} kind={f.previewKind} name={f.name} size={f.size} extension={f.extension} mediaInfo={f.mediaInfo} maxTextBytes={settings.files.previewTextMaxBytes} />}
        <p className="text-center text-xs text-subtle">
          Want to keep and share your own files? <Link href="/register" className="underline-offset-2 hover:underline">Create a free account</Link>.
        </p>
      </div>
    );
  }

  const folder = share.folder!;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <ViewBeacon token={token} />
      <div className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6" style={share.owner?.accent ? { borderTopColor: share.owner.accent, borderTopWidth: 3 } : undefined}>
        <Attribution share={share} />
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning">
            <Folder className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight break-words">{share.title ?? folder.name}</h1>
            <p className="mt-1 text-[13px] text-muted tnum">
              {folder.fileCount.toLocaleString("en-US")} {folder.fileCount === 1 ? "file" : "files"} · {formatBytes(folder.totalSize)}
              {share.shareExpiresAt ? ` · ${timeUntil(share.shareExpiresAt).toLowerCase()}` : ""}
            </p>
          </div>
          {canDownload && folder.fileCount > 0 && !maintenance && (
            <ButtonLink href={`/dl/${token}?mode=zip`} variant="primary" icon={<Download className="size-4" aria-hidden />} prefetch={false} download>
              Download all (.zip)
            </ButtonLink>
          )}
        </div>
        <Message share={share} />
        {maintenance && <p className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning">{settings.maintenance.message}</p>}
        {!canDownload && (
          <p className="mt-4 flex items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-[13px] text-fg">
            <Eye className="size-4 shrink-0 text-accent" aria-hidden /> View only. Downloading is turned off for this link.
          </p>
        )}
      </div>
      <FolderShareList token={token} items={folder.items} totalFiles={folder.fileCount} canDownload={canDownload} />
      <div className="flex justify-end">
        <ReportButton token={token} files={folder.items.map((i) => ({ id: i.id, name: i.path }))} />
      </div>
    </div>
  );
}
