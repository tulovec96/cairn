"use client";

import { Film, ImageIcon, Music, Play } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { FileIcon } from "@/components/ui/FileIcon";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { api, buildQuery, errorMessage } from "@/lib/api-client";
import { formatBytes, formatDuration } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { FileDto, FileListResponse } from "@/lib/types";
import { Lightbox } from "./Lightbox";

type Kind = "image" | "video" | "audio";

const TABS: Array<{ value: Kind; label: string; icon: typeof ImageIcon; empty: string }> = [
  { value: "image", label: "Photos", icon: ImageIcon, empty: "Images you upload anywhere in your files appear here." },
  { value: "video", label: "Videos", icon: Film, empty: "Videos you upload anywhere in your files appear here." },
  { value: "audio", label: "Audio", icon: Music, empty: "Audio files you upload anywhere in your files appear here." },
];

const SORTS = [
  { value: "created", label: "Newest first", order: "desc" },
  { value: "created-asc", label: "Oldest first", order: "asc" },
  { value: "name", label: "Name", order: "asc" },
  { value: "size", label: "Largest first", order: "desc" },
] as const;

function Tile({ file, onOpen }: { file: FileDto; onOpen: () => void }) {
  const dur = file.mediaInfo?.duration;
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`Open ${file.name}`} className="group relative block aspect-square w-full overflow-hidden rounded-lg border border-line bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
        {file.hasThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin thumbnail
          <img src={`/api/v1/files/${file.id}/thumbnail?size=m`} alt="" loading="lazy" className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
        ) : (
          <span className="flex size-full items-center justify-center">
            <FileIcon category={file.category} size="lg" />
          </span>
        )}
        {(file.category === "video" || file.category === "audio") && (
          <span className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white tnum">
            <Play className="size-3" aria-hidden /> {dur ? formatDuration(dur) : ""}
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 text-left text-xs text-white transition-transform group-hover:translate-y-0 group-focus-visible:translate-y-0">
          <span className="block truncate font-medium">{file.name}</span>
          <span className="opacity-80">{formatBytes(file.size)}</span>
        </span>
      </button>
    </li>
  );
}

export function MediaLibrary() {
  const [kind, setKind] = useState<Kind>("image");
  const [sortKey, setSortKey] = useState<(typeof SORTS)[number]["value"]>("created");
  const sort = SORTS.find((s) => s.value === sortKey) ?? SORTS[0];
  const [extra, setExtra] = useState<{ key: string; files: FileDto[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const key = `${kind}|${sortKey}`;
  const query = useMemo(() => ({ view: "all", scope: "everywhere", type: kind, sort: sort.value.replace("-asc", ""), order: sort.order, limit: 100 }), [kind, sort]);
  const first = useResource<FileListResponse>(key, async (signal) => {
    const res = await api<FileListResponse>(`/api/v1/files${buildQuery(query)}`, { signal });
    setExtra(null);
    return res;
  });
  const more = extra && extra.key === key ? extra : null;
  const files = useMemo(() => [...(first.data?.files ?? []), ...(more?.files ?? [])].filter((f) => f.status === "available"), [first.data, more]);
  const cursor = more ? more.cursor : (first.data?.nextCursor ?? null);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await api<FileListResponse>(`/api/v1/files${buildQuery({ ...query, cursor })}`);
      setExtra({ key, files: [...(more?.files ?? []), ...res.files], cursor: res.nextCursor });
    } catch (err) {
      setMoreError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, query, key, more]);

  const tab = TABS.find((t) => t.value === kind)!;
  const Icon = tab.icon;
  return (
    <div>
      <Tabs label="Media type" value={kind} onChange={setKind} tabs={TABS.map((t) => ({ value: t.value, label: t.label }))}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted" aria-live="polite">
            {first.data ? `${first.data.total.toLocaleString("en-US")} ${first.data.total === 1 ? "item" : "items"}` : "Loading…"}
          </p>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="media-sort">
              Sort
            </label>
            <select id="media-sort" value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]">
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {files.length > 0 && (
              <Button size="sm" variant="primary" onClick={() => setOpen(0)} icon={<Play className="size-4" aria-hidden />}>
                Slideshow
              </Button>
            )}
          </div>
        </div>
        {(first.error || moreError) && <ErrorNotice className="mb-3">{first.error ?? moreError}</ErrorNotice>}
        {!first.data && !first.error ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : first.data && files.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface">
            <EmptyState icon={<Icon />} title={`No ${tab.label.toLowerCase()} yet`} description={tab.empty} />
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {files.map((f, i) => (
                <Tile key={f.id} file={f} onOpen={() => setOpen(i)} />
              ))}
            </ul>
            {cursor && (
              <div className="mt-4 flex justify-center">
                <Button onClick={loadMore} loading={loadingMore}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </Tabs>
      {open !== null && files.length > 0 && <Lightbox items={files} index={Math.min(open, files.length - 1)} onIndexChange={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
