"use client";

import { ArrowDown, ArrowUp, Clock, Lock, MoreHorizontal, Play, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/Feedback";
import { Checkbox } from "@/components/ui/Field";
import { FileIcon, FolderIcon } from "@/components/ui/FileIcon";
import { ContextMenu, DropdownMenu, menuJustClosed, type MenuEntry } from "@/components/ui/Menu";
import { cn } from "@/lib/cn";
import { formatBytes, formatDate, timeAgo, timeUntil } from "@/lib/format";
import type { FileDto, FolderDto } from "@/lib/types";
import { keyOf, type Item } from "./types";

export type SortKey = "name" | "size" | "modified" | "downloads" | "type" | "created";
export const VIEW_LAYOUTS = ["list", "compact", "grid", "large", "gallery"] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];
export const LAYOUT_LABELS: Record<ViewLayout, string> = { list: "List", compact: "Compact list", grid: "Grid", large: "Large thumbnails", gallery: "Gallery" };

interface Props {
  folders: FolderDto[];
  files: FileDto[];
  selected: Set<string>;
  layout: ViewLayout;
  sort: SortKey;
  order: "asc" | "desc";
  onSort: (key: SortKey) => void;
  onToggle: (item: Item, shift: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onOpen: (item: Item) => void;
  onDelete: (items: Item[]) => void;
  menuFor: (item: Item) => MenuEntry[];
  showFolders: boolean;
  /** Called when files/folders are dragged onto a folder. */
  onDropOnFolder?: (folder: FolderDto, items: Item[]) => void;
  /** Gallery layout: open the lightbox at this file. */
  onOpenMedia?: (file: FileDto) => void;
}

const COLS = "grid-cols-[2rem_minmax(0,1fr)_2rem] md:grid-cols-[2rem_minmax(0,1fr)_7.5rem_6rem_8rem_5.5rem_2rem]";
const ROW_H: Record<"list" | "compact", number> = { list: 52, compact: 34 };
const VIRTUALIZE_AFTER = 120;

/** What's being dragged inside the page. dataTransfer only carries strings, so the items themselves live here. */
let dragPayload: Item[] | null = null;
export const getDragPayload = () => dragPayload;
export const clearDragPayload = () => {
  dragPayload = null;
};

function ShareCell({ file }: { file: FileDto }) {
  if (file.status === "quarantined") return <Badge tone="danger">Blocked</Badge>;
  if (file.status === "scanning" || file.status === "processing") return <Badge tone="accent">Scanning</Badge>;
  if (!file.share) return <span className="text-subtle">Private</span>;
  return (
    <Badge tone="accent" icon={file.share.hasPassword ? <Lock className="size-3" aria-hidden /> : undefined}>
      {file.shareCount > 1 ? `${file.shareCount} links` : "Shared"}
    </Badge>
  );
}

function Thumb({ file, size, thumb = "s" }: { file: FileDto; size: "sm" | "md"; thumb?: "s" | "m" | "l" }) {
  if (file.hasThumbnail) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin thumbnail
      <img src={`/api/v1/files/${file.id}/thumbnail?size=${thumb}`} alt="" loading="lazy" className={cn("shrink-0 rounded-md border border-line object-cover", size === "sm" ? "size-8" : "size-full")} />
    );
  }
  return <FileIcon category={file.category} size={size === "sm" ? "md" : "lg"} />;
}

function expirySoon(file: FileDto): string | null {
  if (!file.expiresAt) return null;
  const ms = new Date(file.expiresAt).getTime() - Date.now();
  return ms < 3 * 86400_000 ? timeUntil(file.expiresAt) : null;
}

function focusSibling(e: KeyboardEvent<HTMLElement>, dir: 1 | -1) {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-file-row]"));
  const i = rows.indexOf(e.currentTarget);
  rows[i + dir]?.focus();
}

function Header({ label, k, sort, order, onSort, className }: { label: string; k: SortKey; sort: SortKey; order: "asc" | "desc"; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort === k;
  return (
    <div role="columnheader" aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"} className={className}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 rounded text-xs font-medium hover:text-fg", active ? "text-fg" : "text-subtle")}>
        {label}
        {active && (order === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
      </button>
    </div>
  );
}

function TagDots({ file, max = 3 }: { file: FileDto; max?: number }) {
  if (!file.tags.length) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {file.tags.slice(0, max).map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 text-[10px] leading-4 text-muted" title={t.name}>
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: t.color }} />
          <span className="max-w-16 truncate">{t.name}</span>
        </span>
      ))}
      {file.tags.length > max && <span className="text-[10px] text-subtle">+{file.tags.length - max}</span>}
    </span>
  );
}

/** Which slice of a long list is on screen. Rows have a fixed height, so the rest is just spacer. */
function useVisibleRange(count: number, rowHeight: number, enabled: boolean, listRef: React.RefObject<HTMLDivElement | null>) {
  const [range, setRange] = useState({ start: 0, end: 60 });
  useEffect(() => {
    if (!enabled) return;
    const scroller = document.getElementById("main");
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const list = listRef.current;
      if (!list) return;
      const above = scroller.getBoundingClientRect().top - list.getBoundingClientRect().top;
      const start = Math.max(0, Math.floor(above / rowHeight) - 8);
      const end = Math.min(count, Math.ceil((above + scroller.clientHeight) / rowHeight) + 8);
      setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [count, rowHeight, enabled, listRef]);
  return range;
}

export function FileList(props: Props) {
  const { folders, files, selected, layout, sort, order, onSort, onToggle, onToggleAll, onOpen, onDelete, menuFor, showFolders, onDropOnFolder, onOpenMedia } = props;
  const items = useMemo<Item[]>(() => [...(showFolders ? folders.map((folder) => ({ kind: "folder" as const, folder })) : []), ...files.map((file) => ({ kind: "file" as const, file }))], [folders, files, showFolders]);
  const allSelected = items.length > 0 && items.every((i) => selected.has(keyOf(i)));
  const someSelected = !allSelected && items.some((i) => selected.has(keyOf(i)));
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tableLayout = layout === "list" || layout === "compact";
  const virtual = tableLayout && items.length > VIRTUALIZE_AFTER;
  const rowH = ROW_H[layout === "compact" ? "compact" : "list"];
  const range = useVisibleRange(items.length, rowH, virtual, listRef);

  const onKey = (e: KeyboardEvent<HTMLElement>, item: Item) => {
    if ((e.target as HTMLElement).closest("button, input, a, [role=menuitem]") && e.target !== e.currentTarget) return;
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        onOpen(item);
        break;
      case " ":
        e.preventDefault();
        onToggle(item, e.shiftKey);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusSibling(e, 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusSibling(e, -1);
        break;
      case "Delete":
        e.preventDefault();
        onDelete(selected.size && selected.has(keyOf(item)) ? items.filter((i) => selected.has(keyOf(i))) : [item]);
        break;
    }
  };

  // ---- drag and drop (move into a folder) ---------------------------------------------------
  const dragProps = (item: Item) => ({
    draggable: !!onDropOnFolder,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      const key = keyOf(item);
      dragPayload = selected.has(key) ? items.filter((i) => selected.has(keyOf(i))) : [item];
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-cairn-items", String(dragPayload.length));
    },
    onDragEnd: () => {
      dragPayload = null;
      setDropTarget(null);
    },
  });
  const folderDropProps = (folder: FolderDto) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!dragPayload || dragPayload.some((i) => i.kind === "folder" && i.folder.id === folder.id)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(folder.id);
    },
    onDragLeave: () => setDropTarget((t) => (t === folder.id ? null : t)),
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!dragPayload) return;
      e.preventDefault();
      e.stopPropagation();
      const moved = dragPayload.filter((i) => !(i.kind === "folder" && i.folder.id === folder.id));
      dragPayload = null;
      setDropTarget(null);
      if (moved.length) onDropOnFolder?.(folder, moved);
    },
  });

  const meta = (item: Item): { name: string; sub: ReactNode } => {
    if (item.kind === "folder") return { name: item.folder.name, sub: <>Folder · {formatDate(item.folder.updatedAt)}</> };
    const soon = expirySoon(item.file);
    return {
      name: item.file.name,
      sub: (
        <>
          {formatBytes(item.file.size)} · {timeAgo(item.file.updatedAt)}
          {soon && (
            <span className={cn("ml-2 inline-flex items-center gap-0.5", soon === "Expired" ? "text-danger" : "text-warning")}>
              <Clock className="size-3" aria-hidden /> {soon}
            </span>
          )}
        </>
      ),
    };
  };

  const openItem = (item: Item) => (item.kind === "file" && layout === "gallery" && onOpenMedia && (item.file.previewKind === "image" || item.file.previewKind === "video") ? onOpenMedia(item.file) : onOpen(item));

  // ---- card layouts -------------------------------------------------------------------------
  if (layout === "grid" || layout === "large" || layout === "gallery") {
    const gallery = layout === "gallery";
    const shown = gallery ? items.filter((i) => i.kind === "folder" || i.file.category === "image" || i.file.category === "video") : items;
    const cols = layout === "large" ? "grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : gallery ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
    if (gallery && shown.every((i) => i.kind === "folder") && files.length > 0) {
      return <p className="px-6 py-12 text-center text-[13px] text-muted">No images or videos in this view. Switch to another layout to see your other files.</p>;
    }
    return (
      <div className={cn("grid gap-3 p-3", cols)} role="list" aria-label="Files">
        {shown.map((item) => {
          const key = keyOf(item);
          const isSel = selected.has(key);
          const { name, sub } = meta(item);
          const file = item.kind === "file" ? item.file : null;
          const isDrop = item.kind === "folder" && dropTarget === item.folder.id;
          return (
            <ContextMenu key={key} items={() => menuFor(item)} className="contents">
              <div
                role="listitem"
                data-file-row
                tabIndex={0}
                data-selected={isSel || undefined}
                {...dragProps(item)}
                {...(item.kind === "folder" ? folderDropProps(item.folder) : {})}
                onKeyDown={(e) => onKey(e, item)}
                onClick={(e) => {
                  if (menuJustClosed()) return;
                  if (e.metaKey || e.ctrlKey || e.shiftKey || selected.size > 0) onToggle(item, e.shiftKey);
                  else openItem(item);
                }}
                className={cn(
                  "group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-surface transition-colors hover:border-line-strong",
                  isSel ? "border-accent ring-2 ring-accent/30" : isDrop ? "border-accent ring-2 ring-accent/40 bg-accent-soft" : "border-line",
                )}
                style={file?.colorLabel ? { boxShadow: `inset 3px 0 0 ${file.colorLabel}` } : undefined}
              >
                <div className={cn("flex items-center justify-center bg-surface-2", layout === "large" ? "aspect-square" : gallery ? "aspect-square" : "aspect-[4/3]")}>
                  {item.kind === "folder" ? (
                    <FolderIcon size="lg" className="size-14 [&>svg]:size-7" />
                  ) : item.file.hasThumbnail ? (
                    <Thumb file={item.file} size="md" thumb={layout === "large" || gallery ? "m" : "s"} />
                  ) : (
                    <FileIcon category={item.file.category} size="lg" className="size-14 [&>svg]:size-7" />
                  )}
                  {file?.previewKind === "video" && (
                    <span aria-hidden className="absolute inset-0 m-auto flex size-9 items-center justify-center rounded-full bg-black/55 text-white">
                      <Play className="size-4 fill-current" />
                    </span>
                  )}
                </div>
                <div className={cn("absolute top-2 left-2", isSel ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")} onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={isSel} onChange={() => onToggle(item, false)} aria-label={`Select ${name}`} className="size-[18px] bg-surface" />
                </div>
                <div className="absolute top-1.5 right-1.5" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu
                    items={menuFor(item)}
                    trigger={
                      <button type="button" aria-label={`Actions for ${name}`} className="flex size-7 items-center justify-center rounded-md bg-surface/90 text-muted opacity-0 shadow-sm group-hover:opacity-100 group-focus-within:opacity-100 hover:text-fg data-[state=open]:opacity-100">
                        <MoreHorizontal className="size-4" aria-hidden />
                      </button>
                    }
                  />
                </div>
                {!gallery && (
                  <div className="min-w-0 px-3 py-2">
                    <p className="flex items-center gap-1 truncate text-[13px] font-medium" title={name}>
                      {(item.kind === "file" ? item.file.favorite : item.folder.favorite) && <Star className="size-3 shrink-0 fill-warning text-warning" aria-label="Favorite" />}
                      <span className="truncate">{name}</span>
                    </p>
                    <p className="truncate text-xs text-muted tnum">{sub}</p>
                    {file && file.tags.length > 0 && <div className="mt-1"><TagDots file={file} max={2} /></div>}
                  </div>
                )}
                {gallery && (
                  <p className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 pt-6 pb-1.5 text-xs font-medium text-white opacity-0 group-hover:opacity-100">{name}</p>
                )}
              </div>
            </ContextMenu>
          );
        })}
      </div>
    );
  }

  // ---- table layouts ------------------------------------------------------------------------
  const start = virtual ? range.start : 0;
  const end = virtual ? Math.min(range.end, items.length) : items.length;
  const compact = layout === "compact";
  return (
    <div role="table" aria-label="Files" aria-rowcount={items.length + 1}>
      <div role="row" className={cn("sticky top-0 z-10 grid items-center gap-x-3 border-b border-line bg-surface px-3 py-2", COLS)}>
        <div role="columnheader" className="flex items-center">
          <Checkbox checked={allSelected} ref={(el) => void (el && (el.indeterminate = someSelected))} onChange={(e) => onToggleAll(e.target.checked)} aria-label="Select all" />
        </div>
        <Header label="Name" k="name" sort={sort} order={order} onSort={onSort} />
        <div role="columnheader" className="hidden text-xs font-medium text-subtle md:block">
          Sharing
        </div>
        <Header label="Size" k="size" sort={sort} order={order} onSort={onSort} className="hidden md:block" />
        <Header label="Modified" k="modified" sort={sort} order={order} onSort={onSort} className="hidden md:block" />
        <Header label="Downloads" k="downloads" sort={sort} order={order} onSort={onSort} className="hidden md:block" />
        <div role="columnheader" className="sr-only">
          Actions
        </div>
      </div>
      <div ref={listRef} style={virtual ? { paddingTop: start * rowH, paddingBottom: (items.length - end) * rowH } : undefined}>
        {items.slice(start, end).map((item, offset) => {
          const key = keyOf(item);
          const isSel = selected.has(key);
          const { name, sub } = meta(item);
          const fav = item.kind === "file" ? item.file.favorite : item.folder.favorite;
          const isDrop = item.kind === "folder" && dropTarget === item.folder.id;
          return (
            <ContextMenu key={key} items={() => menuFor(item)} className="contents">
              <div
                role="row"
                aria-rowindex={start + offset + 2}
                data-file-row
                tabIndex={0}
                aria-selected={isSel}
                {...dragProps(item)}
                {...(item.kind === "folder" ? folderDropProps(item.folder) : {})}
                onKeyDown={(e) => onKey(e, item)}
                onClick={(e) => {
                  if (menuJustClosed() || (e.target as HTMLElement).closest("button, a, input, label")) return;
                  onToggle(item, e.shiftKey);
                }}
                onDoubleClick={() => onOpen(item)}
                style={{ height: rowH, ...(item.kind === "file" && item.file.colorLabel ? { boxShadow: `inset 3px 0 0 ${item.file.colorLabel}` } : {}) }}
                className={cn(
                  "grid cursor-default items-center gap-x-3 border-b border-line px-3 transition-colors last:border-b-0",
                  COLS,
                  isSel ? "bg-accent-soft" : isDrop ? "bg-accent-soft ring-2 ring-accent/50 ring-inset" : "hover:bg-surface-2",
                )}
              >
                <div role="gridcell" className="flex items-center">
                  <Checkbox checked={isSel} onChange={(e) => onToggle(item, (e.nativeEvent as MouseEvent).shiftKey === true)} aria-label={`Select ${name}`} />
                </div>
                <div role="gridcell" className="flex min-w-0 items-center gap-3">
                  {!compact && (item.kind === "folder" ? <FolderIcon /> : <Thumb file={item.file} size="sm" />)}
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <button type="button" onClick={() => onOpen(item)} className="flex min-w-0 items-center gap-1.5 rounded text-left text-[13px] font-medium text-fg hover:text-accent hover:underline" title={name}>
                        <span className="truncate">{name}</span>
                        {fav && <Star className="size-3 shrink-0 fill-warning text-warning" aria-label="Favorite" />}
                      </button>
                      {item.kind === "file" && <span className="hidden shrink-0 lg:inline"><TagDots file={item.file} /></span>}
                    </div>
                    {!compact && <p className="truncate text-xs text-muted tnum md:hidden">{sub}</p>}
                    {!compact && item.kind === "file" && expirySoon(item.file) && (
                      <p className="hidden items-center gap-1 text-xs text-warning md:flex">
                        <Clock className="size-3" aria-hidden /> {expirySoon(item.file)}
                      </p>
                    )}
                  </div>
                </div>
                <div role="gridcell" className="hidden text-xs md:block">
                  {item.kind === "file" ? <ShareCell file={item.file} /> : item.folder.share ? <Badge tone="accent">Shared</Badge> : <span className="text-subtle">Private</span>}
                </div>
                <div role="gridcell" className="hidden text-xs text-muted tnum md:block">
                  {item.kind === "file" ? formatBytes(item.file.size) : "—"}
                </div>
                <div role="gridcell" className="hidden text-xs text-muted md:block" title={item.kind === "file" ? item.file.updatedAt : item.folder.updatedAt}>
                  {formatDate(item.kind === "file" ? item.file.updatedAt : item.folder.updatedAt)}
                </div>
                <div role="gridcell" className="hidden text-xs text-muted tnum md:block">
                  {item.kind === "file" ? item.file.downloadCount.toLocaleString("en-US") : "—"}
                </div>
                <div role="gridcell" className="flex justify-end">
                  <DropdownMenu
                    items={menuFor(item)}
                    trigger={
                      <button type="button" aria-label={`Actions for ${name}`} className="flex size-8 items-center justify-center rounded-md text-subtle hover:bg-surface-3 hover:text-fg data-[state=open]:bg-surface-3">
                        <MoreHorizontal className="size-4" aria-hidden />
                      </button>
                    }
                  />
                </div>
              </div>
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}
