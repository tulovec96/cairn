"use client";

import { FileUpload } from "@ark-ui/react/file-upload";
import {
  AlignJustify,
  Archive,
  ArchiveRestore,
  Bookmark,
  CalendarClock,
  ChevronRight,
  Clock,
  CopyPlus,
  Download,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Grid2x2,
  Images,
  LayoutGrid,
  List,
  Link2,
  Pencil,
  Search,
  SearchX,
  Star,
  StarOff,
  Tag,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useCan } from "@/components/layout/AccountContext";
import { Lightbox } from "@/components/media/Lightbox";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { EmptyState, ErrorNotice, Skeleton, Spinner } from "@/components/ui/Feedback";
import { DropdownMenu } from "@/components/ui/Menu";
import { Drawer } from "@/components/ui/Modal";
import { Tip } from "@/components/ui/Overlays";
import { useUploadComplete } from "@/components/upload/UploadProvider";
import { useUploadIntake } from "@/components/upload/useUploadIntake";
import { UploadQueue } from "@/components/upload/UploadQueue";
import { api, buildQuery, errorMessage } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";
import { useStoredValue } from "@/lib/useStoredValue";
import { cn } from "@/lib/cn";
import { CATEGORY_LABELS } from "@/lib/fileTypes";
import { formatBytes, pluralize } from "@/lib/format";
import type { AuthedConfigDto, FileDto, FileListResponse, FolderDto, PublicConfigDto, UsageDto } from "@/lib/types";
import { FileDetailsPanel } from "./FileDetailsPanel";
import { FileList, LAYOUT_LABELS, VIEW_LAYOUTS, clearDragPayload, getDragPayload, type SortKey, type ViewLayout } from "./FileList";
import { SearchHelp } from "./SearchHelp";
import { SaveSearchDialog } from "./toolDialogs";
import { itemMenu } from "./menus";
import { keyOf, type Item } from "./types";
import { useFileActions } from "./useFileActions";

type View = "all" | "recent" | "favorites" | "shared" | "archived";

const EMPTY_KEYS: Set<string> = new Set();

interface Props {
  view: View;
  config: AuthedConfigDto;
  title: string;
  description?: string;
}

const RECENT_TABS = [
  { value: "uploaded", label: "Uploaded" },
  { value: "modified", label: "Modified" },
  { value: "accessed", label: "Opened" },
  { value: "shared", label: "Shared" },
] as const;

const SORT_LABELS: Record<SortKey, string> = { name: "Name", size: "Size", modified: "Modified", downloads: "Downloads", type: "Type", created: "Uploaded" };

const LAYOUT_ICONS: Record<ViewLayout, typeof List> = { list: List, compact: AlignJustify, grid: LayoutGrid, large: Grid2x2, gallery: Images };

function QuotaNotice({ usage }: { usage: UsageDto }) {
  if (usage.quotaBytes < 0 || usage.percent < 75) return null;
  const full = usage.percent >= 100;
  return (
    <ErrorNotice tone={usage.percent >= 95 ? "danger" : "warning"} className="mb-4">
      <p className="font-medium">
        {full ? "Storage is full. New uploads are blocked." : `Storage is ${Math.round(usage.percent)}% full.`}{" "}
        <span className="font-normal tnum">
          {formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)} used.
        </span>
      </p>
      <p className="mt-1 text-xs opacity-90">Free up space by deleting large files, or emptying the trash (trashed files still count until they are removed).</p>
      <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
        <Link href="/files?sort=size&order=desc" className="underline underline-offset-2">
          Find the largest files
        </Link>
        <Link href="/duplicates" className="underline underline-offset-2">
          Find duplicates
        </Link>
        <Link href="/trash" className="underline underline-offset-2">
          Empty trash
        </Link>
        <Link href="/settings/billing" className="underline underline-offset-2">
          See plans
        </Link>
      </div>
    </ErrorNotice>
  );
}

export function FileBrowser({ view, config, title, description }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canWrite = useCan("write");
  const canDelete = useCan("delete");
  const canShare = useCan("share");
  const { workspace } = useAccount();

  const q = params.get("q") ?? "";
  const folder = view === "all" ? params.get("folder") : null;
  const type = params.get("type") ?? "";
  const sort = (params.get("sort") as SortKey | null) ?? "name";
  const order = params.get("order") === "desc" ? "desc" : "asc";
  const by = (params.get("by") as "uploaded" | "modified" | "accessed" | "shared" | null) ?? "uploaded";
  const searching = !!(q || type);

  const [layout, changeLayout] = useStoredValue<ViewLayout>("cairn:layout:v2", "list", VIEW_LAYOUTS);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [saveSearch, setSaveSearch] = useState(false);
  const [crumbDrop, setCrumbDrop] = useState<string | null>(null);

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // ---- data ---------------------------------------------------------------------------------
  const listKey = params.toString();
  const [usage, setUsage] = useState<UsageDto | null>(config.usage);
  const loadedCount = useRef(50);
  const [extra, setExtra] = useState<{ key: string; files: FileDto[]; cursor: string | null; total: number } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const baseQuery = useMemo(() => ({ view, folderId: folder ?? "root", q, type, sort, order, by: view === "recent" ? by : undefined }), [view, folder, q, type, sort, order, by]);

  // First page (or as many files as were already loaded, so a refresh keeps your place).
  const first = useResource<FileListResponse>(listKey, async (signal) => {
    const res = await api<FileListResponse>(`/api/v1/files${buildQuery({ ...baseQuery, limit: Math.min(200, Math.max(50, loadedCount.current)) })}`, { signal });
    loadedCount.current = Math.max(50, res.files.length);
    setExtra(null);
    return res;
  });
  const extraForKey = extra && extra.key === listKey ? extra : null;
  const data = useMemo<FileListResponse | null>(
    () => (first.data ? { ...first.data, files: [...first.data.files, ...(extraForKey?.files ?? [])], nextCursor: extraForKey ? extraForKey.cursor : first.data.nextCursor, total: extraForKey?.total ?? first.data.total } : null),
    [first.data, extraForKey],
  );
  const loading = first.loading || first.refreshing;
  const error = first.error ?? moreError;
  const { reload } = first;

  const refresh = useCallback(() => {
    reload();
    api<{ config: PublicConfigDto }>("/api/v1/config").then((r) => setUsage(r.config.usage), () => undefined);
  }, [reload]);

  const loadMore = async () => {
    if (!data?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await api<FileListResponse>(`/api/v1/files${buildQuery({ ...baseQuery, limit: 50, cursor: data.nextCursor })}`);
      const seen = new Set(data.files.map((f) => f.id));
      loadedCount.current += res.files.length;
      setExtra({ key: listKey, files: [...(extraForKey?.files ?? []), ...res.files.filter((f) => !seen.has(f.id))], cursor: res.nextCursor, total: res.total });
    } catch (err) {
      setMoreError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  // Refresh when an upload lands in the folder being viewed.
  useUploadComplete(
    useCallback(() => {
      if (view === "all") refresh();
    }, [view, refresh]),
  );

  // ---- selection ----------------------------------------------------------------------------
  // Selection belongs to one view/folder/search; a different scope starts empty without an effect.
  const scopeKey = `${view}|${folder}|${q}|${type}|${by}`;
  const [selState, setSelState] = useState<{ scope: string; keys: Set<string> }>({ scope: scopeKey, keys: new Set() });
  const selected = selState.scope === scopeKey ? selState.keys : EMPTY_KEYS;
  const setSelected = useCallback(
    (update: Set<string> | ((prev: Set<string>) => Set<string>)) =>
      setSelState((prev) => {
        const base = prev.scope === scopeKey ? prev.keys : EMPTY_KEYS;
        return { scope: scopeKey, keys: typeof update === "function" ? update(base) : update };
      }),
    [scopeKey],
  );
  const lastClicked = useRef<string | null>(null);

  const items = useMemo<Item[]>(
    () => (data ? [...data.folders.map((f) => ({ kind: "folder" as const, folder: f })), ...data.files.map((f) => ({ kind: "file" as const, file: f }))] : []),
    [data],
  );
  const selectedItems = useMemo(() => items.filter((i) => selected.has(keyOf(i))), [items, selected]);

  const toggle = useCallback(
    (item: Item, shift: boolean) => {
      const key = keyOf(item);
      setSelected((prev) => {
        const next = new Set(prev);
        if (shift && lastClicked.current) {
          const keys = items.map(keyOf);
          const a = keys.indexOf(lastClicked.current);
          const b = keys.indexOf(key);
          if (a >= 0 && b >= 0) {
            for (const k of keys.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(k);
            return next;
          }
        }
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      lastClicked.current = key;
    },
    [items, setSelected],
  );
  const toggleAll = useCallback((checked: boolean) => setSelected(checked ? new Set(items.map(keyOf)) : new Set()), [items, setSelected]);

  // ---- actions ------------------------------------------------------------------------------
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [detailsKey, setDetailsKey] = useState(0);
  const onChanged = useCallback(() => {
    refresh();
    setDetailsKey((k) => k + 1);
  }, [refresh]);

  const openFolder = useCallback((id: string) => setParams({ folder: id, q: null, type: null }), [setParams]);
  const { actions, dialogs } = useFileActions({
    limits: config.limits,
    currentFolderId: folder,
    onChanged,
    onOpenFile: setDetailsId,
    onOpenFolder: openFolder,
  });
  const can = useMemo(() => ({ write: canWrite, delete: canDelete, share: canShare, people: canShare && !workspace.orgId }), [canWrite, canDelete, canShare, workspace.orgId]);
  const menuFor = useCallback((item: Item) => itemMenu(item, { actions, onDetails: setDetailsId, can }), [actions, can]);

  // ---- media (gallery lightbox) -------------------------------------------------------------
  const media = useMemo(() => (data?.files ?? []).filter((f) => f.status === "available" && (f.previewKind === "image" || f.previewKind === "video")), [data]);
  const openMedia = useCallback((file: FileDto) => setLightbox(media.findIndex((m) => m.id === file.id)), [media]);

  // ---- uploads ------------------------------------------------------------------------------
  const allowNever = config.limits.allowNever;
  const uploadsBlocked = !canWrite || (config.maintenance.enabled && config.maintenance.disableUploads);
  const { api: uploadApi, openFiles, openFolder: pickFolder } = useUploadIntake({
    limits: config.limits,
    blockedExtensions: config.blockedExtensions,
    allowedExtensions: config.allowedExtensions,
    getOptions: () => ({ share: false, ...(allowNever ? { expiresAt: null } : {}) }),
    folderId: folder,
    canUseFolders: true,
    disabled: view !== "all" || uploadsBlocked,
  });

  // ---- keyboard -----------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable)) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === "Escape" && selected.size) setSelected(new Set());
      else if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey) && items.length) {
        e.preventDefault();
        toggleAll(true);
      } else if (e.key === "Delete" && selectedItems.length && canDelete && !el?.closest("[data-file-row]")) {
        e.preventDefault();
        void actions.remove(selectedItems);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, items, selectedItems, toggleAll, actions, setSelected, canDelete]);

  const onSort = (key: SortKey) => setParams({ sort: key, order: sort === key && order === "asc" ? "desc" : "asc" });

  // ---- derived ------------------------------------------------------------------------------
  const crumbs = data?.breadcrumbs ?? [];
  const folderName = crumbs.length > 1 ? crumbs[crumbs.length - 1].name : null;
  const hasSelection = selected.size > 0;
  const allFav = selectedItems.length > 0 && selectedItems.every((i) => (i.kind === "file" ? i.file.favorite : i.folder.favorite));
  const onlyFiles = selectedItems.length > 0 && selectedItems.every((i) => i.kind === "file");
  const allArchived = onlyFiles && selectedItems.every((i) => i.kind === "file" && !!i.file.archivedAt);
  const empty = !!data && items.length === 0;
  const LayoutIcon = LAYOUT_ICONS[layout];
  const dropOnFolder = useCallback((f: FolderDto, dragged: Item[]) => void actions.moveInto(dragged, f.id, f.name), [actions]);

  const emptyState = (() => {
    if (searching) {
      return (
        <EmptyState
          icon={<SearchX />}
          title={q ? `No matches for “${q}”` : "No files match these filters"}
          description="Try a different search, or use operators like ext:png and type:image to narrow results."
          action={
            <Button onClick={() => setParams({ q: null, type: null })} icon={<X className="size-4" aria-hidden />}>
              Clear filters
            </Button>
          }
        />
      );
    }
    switch (view) {
      case "favorites":
        return <EmptyState icon={<Star />} title="No favorites yet" description="Star files and folders to keep them one click away." action={<Link href="/files" className="text-[13px] font-medium text-accent hover:underline">Browse your files</Link>} />;
      case "recent":
        return <EmptyState icon={<Clock />} title="Nothing here yet" description="Files you upload, change, open or share will show up in this list." action={<Link href="/upload" className="text-[13px] font-medium text-accent hover:underline">Upload a file</Link>} />;
      case "archived":
        return <EmptyState icon={<Archive />} title="Nothing archived" description="Archive files you want out of the way but not deleted. They stay searchable and keep counting toward storage." action={<Link href="/files" className="text-[13px] font-medium text-accent hover:underline">Browse your files</Link>} />;
      case "shared":
        return <EmptyState icon={<Link2 />} title="Nothing is shared" description="Create a link from any file's menu to share it." />;
      default:
        return (
          <EmptyState
            icon={<FolderOpen />}
            title={folder ? "This folder is empty" : "No files yet"}
            description={canWrite ? "Drop files anywhere on this page, or use the buttons below." : "Nothing has been added here yet."}
            action={
              canWrite ? (
                <>
                  <Button variant="primary" onClick={openFiles} disabled={uploadsBlocked} icon={<UploadCloud className="size-4" aria-hidden />}>
                    Upload files
                  </Button>
                  <Button onClick={actions.newFolder} icon={<FolderPlus className="size-4" aria-hidden />}>
                    New folder
                  </Button>
                </>
              ) : undefined
            }
          />
        );
    }
  })();

  return (
    <FileUpload.RootProvider value={uploadApi}>
      <FileUpload.Dropzone disableClick className="relative min-h-full outline-none">
        <FileUpload.HiddenInput />
        {uploadApi.dragging && view === "all" && !getDragPayload() && (
          <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/90 text-center">
            <div>
              <UploadCloud className="mx-auto mb-2 size-8 text-accent" aria-hidden />
              <p className="text-sm font-semibold">Drop to upload{folderName ? ` to “${folderName}”` : ""}</p>
            </div>
          </div>
        )}

        <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
            <div className="min-w-0">
              {view === "all" ? (
                <nav aria-label="Breadcrumb">
                  <ol className="flex flex-wrap items-center gap-1 text-xl font-semibold tracking-tight">
                    {(crumbs.length ? crumbs : [{ id: null, name: "All files" }]).map((c, i, arr) => (
                      <li key={c.id ?? "root"} className="flex items-center gap-1">
                        {i > 0 && <ChevronRight className="size-4 text-subtle" aria-hidden />}
                        {i === arr.length - 1 ? (
                          <h1 aria-current="page" className="truncate">{c.name}</h1>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setParams({ folder: c.id, q: null, type: null })}
                            onDragOver={(e) => {
                              if (!getDragPayload() || !canWrite) return;
                              e.preventDefault();
                              setCrumbDrop(c.id ?? "root");
                            }}
                            onDragLeave={() => setCrumbDrop(null)}
                            onDrop={(e) => {
                              const dragged = getDragPayload();
                              if (!dragged || !canWrite) return;
                              e.preventDefault();
                              clearDragPayload();
                              setCrumbDrop(null);
                              void actions.moveInto(dragged, c.id, c.name);
                            }}
                            className={cn("rounded px-1 text-muted hover:text-fg hover:underline", crumbDrop === (c.id ?? "root") && "bg-accent-soft text-fg ring-2 ring-accent/50")}
                          >
                            {c.name}
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                </nav>
              ) : (
                <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              )}
              {description && view !== "all" && <p className="mt-1 text-[13px] text-muted">{description}</p>}
              {data && (
                <p className="mt-0.5 text-xs text-subtle tnum" aria-live="polite">
                  {pluralize(data.folders.length + data.total, "item")}
                  {searching ? " match" : ""}
                </p>
              )}
            </div>
            {view === "all" && canWrite && (
              <div className="flex items-center gap-2">
                <Button onClick={actions.newFolder} icon={<FolderPlus className="size-4" aria-hidden />}>
                  <span className="hidden sm:inline">New folder</span>
                  <span className="sm:hidden">Folder</span>
                </Button>
                <DropdownMenu
                  trigger={
                    <Button variant="primary" disabled={uploadsBlocked} icon={<UploadCloud className="size-4" aria-hidden />}>
                      Upload
                    </Button>
                  }
                  items={[
                    { value: "files", label: "Upload files", icon: <UploadCloud />, onSelect: openFiles },
                    { value: "folder", label: "Upload folder", icon: <FolderUp />, onSelect: pickFolder },
                  ]}
                />
              </div>
            )}
          </div>

          {view === "all" && config.maintenance.enabled && config.maintenance.disableUploads && <ErrorNotice tone="warning" className="mb-4">{config.maintenance.message}</ErrorNotice>}
          {usage && view === "all" && <QuotaNotice usage={usage} />}

          {view === "recent" && (
            <div role="tablist" aria-label="Recent files" className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5">
              {RECENT_TABS.map((t) => (
                <button
                  key={t.value}
                  role="tab"
                  type="button"
                  aria-selected={by === t.value}
                  onClick={() => setParams({ by: t.value })}
                  className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors", by === t.value ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <UploadQueue className="mb-4 [&_ul]:max-h-56" />

          {/* Toolbar */}
          <div className="sticky top-0 z-20 -mx-1 mb-3 bg-bg/95 px-1 py-1 backdrop-blur">
            {hasSelection ? (
              <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-1.5 rounded-lg border border-accent-line bg-accent-soft px-2.5 py-1.5">
                <span className="mr-1 text-[13px] font-medium tnum" aria-live="polite">
                  {selected.size} selected
                </span>
                <Button size="sm" onClick={() => actions.download(selectedItems)} icon={<Download className="size-4" aria-hidden />}>
                  Download
                </Button>
                {canShare && (
                  <Button size="sm" onClick={() => void actions.shareMany(selectedItems)} icon={<Link2 className="size-4" aria-hidden />}>
                    Share
                  </Button>
                )}
                {canWrite && (
                  <Button size="sm" onClick={() => actions.move(selectedItems)} icon={<FolderInput className="size-4" aria-hidden />}>
                    Move
                  </Button>
                )}
                {canWrite && onlyFiles && (
                  <>
                    <Button size="sm" onClick={() => actions.copyTo(selectedItems)} icon={<CopyPlus className="size-4" aria-hidden />}>
                      Copy
                    </Button>
                    <Button size="sm" onClick={() => actions.tag(selectedItems)} icon={<Tag className="size-4" aria-hidden />}>
                      Tags
                    </Button>
                  </>
                )}
                <Button size="sm" onClick={() => void actions.setFavorite(selectedItems, !allFav)} icon={allFav ? <StarOff className="size-4" aria-hidden /> : <Star className="size-4" aria-hidden />}>
                  {allFav ? "Unfavorite" : "Favorite"}
                </Button>
                {canWrite && onlyFiles && (
                  <>
                    <Button size="sm" onClick={() => actions.expiry(selectedItems)} icon={<CalendarClock className="size-4" aria-hidden />}>
                      Expiration
                    </Button>
                    <Button size="sm" onClick={() => void actions.setArchived(selectedItems, !allArchived)} icon={allArchived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}>
                      {allArchived ? "Unarchive" : "Archive"}
                    </Button>
                    {selectedItems.length > 1 && (
                      <Button size="sm" onClick={() => actions.batchRename(selectedItems)} icon={<Pencil className="size-4" aria-hidden />}>
                        Rename…
                      </Button>
                    )}
                  </>
                )}
                {canDelete && (
                  <Button size="sm" variant="danger-outline" onClick={() => void actions.remove(selectedItems)} icon={<Trash2 className="size-4" aria-hidden />}>
                    Trash
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())} icon={<X className="size-4" aria-hidden />}>
                  Clear
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {view !== "recent" && (
                  <>
                    <label className="sr-only" htmlFor="filter-type">
                      Filter by type
                    </label>
                    <Select id="filter-type" value={type} onChange={(e) => setParams({ type: e.target.value || null })} className="h-8 w-auto text-[13px]">
                      <option value="">All types</option>
                      {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </Select>
                    <label className="sr-only" htmlFor="sort-by">
                      Sort by
                    </label>
                    <Select id="sort-by" value={sort} onChange={(e) => setParams({ sort: e.target.value })} className="h-8 w-auto text-[13px]">
                      {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                        <option key={k} value={k}>
                          Sort: {SORT_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                    <Tip label={order === "asc" ? "Ascending" : "Descending"}>
                      <Button size="sm" variant="secondary" onClick={() => setParams({ order: order === "asc" ? "desc" : "asc" })} aria-label={`Sort order: ${order === "asc" ? "ascending" : "descending"}. Toggle.`}>
                        {order === "asc" ? "A→Z" : "Z→A"}
                      </Button>
                    </Tip>
                  </>
                )}
                {searching && (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1 text-[13px] text-muted">
                    <Search className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{q ? `“${q}”` : CATEGORY_LABELS[type as keyof typeof CATEGORY_LABELS]}</span>
                    <button type="button" aria-label="Clear search and filters" onClick={() => setParams({ q: null, type: null })} className="rounded p-0.5 hover:bg-surface-3 hover:text-fg">
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                )}
                {q && (
                  <Button size="sm" variant="secondary" onClick={() => setSaveSearch(true)} icon={<Bookmark className="size-3.5" aria-hidden />}>
                    Save search
                  </Button>
                )}
                <SearchHelp />
                <div className="ml-auto">
                  <DropdownMenu
                    trigger={
                      <Button size="sm" variant="secondary" aria-label={`View: ${LAYOUT_LABELS[layout]}. Change view.`} icon={<LayoutIcon className="size-4" aria-hidden />}>
                        <span className="hidden sm:inline">{LAYOUT_LABELS[layout]}</span>
                      </Button>
                    }
                    items={VIEW_LAYOUTS.map((l) => {
                      const Icon = LAYOUT_ICONS[l];
                      return { value: l, label: LAYOUT_LABELS[l] + (l === layout ? " ✓" : ""), icon: <Icon />, onSelect: () => changeLayout(l) };
                    })}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            {error && !data ? (
              <div className="p-6">
                <ErrorNotice>
                  <div className="flex items-center justify-between gap-3">
                    <span>{error}</span>
                    <Button size="sm" onClick={refresh}>
                      Try again
                    </Button>
                  </div>
                </ErrorNotice>
              </div>
            ) : !data ? (
              <div className="divide-y divide-line" aria-busy="true" aria-label="Loading files">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <Skeleton className="size-4" />
                    <Skeleton className="size-8" />
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="ml-auto hidden h-4 w-24 md:block" />
                  </div>
                ))}
              </div>
            ) : empty ? (
              emptyState
            ) : (
              <>
                {error && <ErrorNotice className="m-3">{error}</ErrorNotice>}
                <FileList
                  folders={data.folders}
                  files={data.files}
                  selected={selected}
                  layout={layout}
                  sort={sort}
                  order={order}
                  onSort={onSort}
                  onToggle={toggle}
                  onToggleAll={toggleAll}
                  onOpen={actions.openItem}
                  onDelete={(list) => canDelete && void actions.remove(list)}
                  menuFor={menuFor}
                  showFolders
                  onDropOnFolder={canWrite && view === "all" ? dropOnFolder : undefined}
                  onOpenMedia={openMedia}
                />
                {data.nextCursor && (
                  <div className="flex justify-center border-t border-line p-3">
                    <Button onClick={loadMore} loading={loadingMore}>
                      Load more ({(data.total - data.files.length).toLocaleString("en-US")} more)
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
          {loading && data && (
            <div className="mt-2 flex justify-center">
              <Spinner label="Updating" />
            </div>
          )}
        </div>

        {dialogs}
        {saveSearch && <SaveSearchDialog query={q} onClose={() => setSaveSearch(false)} />}
        {lightbox !== null && lightbox >= 0 && media.length > 0 && <Lightbox items={media} index={Math.min(lightbox, media.length - 1)} onIndexChange={setLightbox} onClose={() => setLightbox(null)} />}
        <Drawer open={!!detailsId} onOpenChange={(o) => !o && setDetailsId(null)} title="File details" width="w-full sm:w-[30rem]">
          {detailsId && <FileDetailsPanel fileId={detailsId} actions={actions} refreshKey={detailsKey} onChanged={onChanged} />}
        </Drawer>
      </FileUpload.Dropzone>
    </FileUpload.RootProvider>
  );
}
