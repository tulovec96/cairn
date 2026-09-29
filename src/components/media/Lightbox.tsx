"use client";

import { Dialog } from "@ark-ui/react/dialog";
import { Portal } from "@ark-ui/react/portal";
import { ChevronLeft, ChevronRight, Download, Info, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { ImageViewer } from "@/components/viewers/ImageViewer";
import { cn } from "@/lib/cn";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import type { FileDto } from "@/lib/types";

export type LightboxItem = Pick<FileDto, "id" | "name" | "size" | "mime" | "extension" | "category" | "previewKind" | "mediaInfo" | "createdAt" | "sha256">;

interface Props {
  items: LightboxItem[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}

const INTERVALS = [3, 5, 8, 15] as const;

/** Full-screen media viewer: arrows and swipe-free keyboard navigation, zoomable images, video, and a real slideshow timer. */
export function Lightbox({ items, index, onIndexChange, onClose }: Props) {
  const [playing, setPlaying] = useState(false);
  const [interval, setIntervalSec] = useState<(typeof INTERVALS)[number]>(5);
  const [info, setInfo] = useState(false);
  const item = items[index];
  const go = useCallback((delta: number) => onIndexChange((index + delta + items.length) % items.length), [index, items.length, onIndexChange]);
  const isVideo = item?.previewKind === "video";

  // Slideshow: advance on a timer. Videos advance when they end instead (see onEnded), never mid-playback.
  useEffect(() => {
    if (!playing || isVideo || items.length < 2) return;
    const t = setTimeout(() => go(1), interval * 1000);
    return () => clearTimeout(t);
  }, [playing, isVideo, interval, index, items.length, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^(input|textarea|select)$/i.test((e.target as HTMLElement).tagName)) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key.toLowerCase() === "i") setInfo((v) => !v);
      else if (e.key === " " && !isVideo && (e.target as HTMLElement).tagName !== "BUTTON") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, isVideo]);

  // Warm the cache for the neighbours so navigation feels instant.
  useEffect(() => {
    for (const d of [1, -1]) {
      const n = items[(index + d + items.length) % items.length];
      if (n && n.previewKind === "image") new Image().src = `/api/v1/files/${n.id}/preview`;
    }
  }, [index, items]);

  if (!item) return null;
  const src = `/api/v1/files/${item.id}/preview`;
  const kind = item.previewKind;
  return (
    <Dialog.Root open onOpenChange={(e) => !e.open && onClose()} lazyMount unmountOnExit>
      <Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/95" />
        <Dialog.Positioner className="fixed inset-0 z-50 flex">
          <Dialog.Content className="flex size-full flex-col text-white outline-none">
            <Dialog.Title className="sr-only">
              {item.name} ({index + 1} of {items.length})
            </Dialog.Title>
            <div className="flex items-center gap-2 px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium" aria-live="polite">
                {item.name} <span className="ml-2 text-xs font-normal text-white/60 tnum">{index + 1} / {items.length}</span>
              </p>
              {items.length > 1 && (
                <>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" aria-label={playing ? "Pause slideshow" : "Start slideshow"} aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
                    {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                  </Button>
                  <label className="sr-only" htmlFor="slide-interval">Seconds per slide</label>
                  <Select id="slide-interval" value={interval} onChange={(e) => setIntervalSec(Number(e.target.value) as (typeof INTERVALS)[number])} className="h-8 w-auto border-white/20 bg-transparent py-0 text-xs text-white">
                    {INTERVALS.map((s) => (
                      <option key={s} value={s} className="text-black">
                        {s}s per slide
                      </option>
                    ))}
                  </Select>
                </>
              )}
              <Button variant="ghost" size="icon" className={cn("text-white hover:bg-white/10 hover:text-white", info && "bg-white/15")} aria-label="Show details (I)" aria-pressed={info} onClick={() => setInfo((v) => !v)}>
                <Info className="size-4" aria-hidden />
              </Button>
              <a href={`/api/v1/files/${item.id}/download`} download={item.name} aria-label={`Download ${item.name}`} className="inline-flex size-9 items-center justify-center rounded-md hover:bg-white/10">
                <Download className="size-4" aria-hidden />
              </a>
              <Dialog.CloseTrigger aria-label="Close viewer" className="inline-flex size-9 items-center justify-center rounded-md hover:bg-white/10">
                <X className="size-5" aria-hidden />
              </Dialog.CloseTrigger>
            </div>

            <div className="relative flex min-h-0 flex-1">
              <div className="relative min-w-0 flex-1">
                {kind === "image" || kind === "svg" ? (
                  <ImageViewer key={item.id} src={src} alt={item.name} className="size-full rounded-none border-0 bg-transparent" height="100%" />
                ) : kind === "video" ? (
                  <div className="flex size-full items-center justify-center p-4">
                    <video key={item.id} src={src} controls autoPlay playsInline onEnded={() => playing && go(1)} className="max-h-full max-w-full" aria-label={`Video: ${item.name}`} />
                  </div>
                ) : kind === "audio" ? (
                  <div className="flex size-full items-center justify-center p-6">
                    <audio key={item.id} src={src} controls autoPlay className="w-full max-w-xl" aria-label={`Audio: ${item.name}`} />
                  </div>
                ) : (
                  <p className="flex size-full items-center justify-center text-sm text-white/70">This file can&apos;t be previewed. Download it instead.</p>
                )}
                {items.length > 1 && (
                  <>
                    <button type="button" aria-label="Previous" onClick={() => go(-1)} className="absolute top-1/2 left-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                      <ChevronLeft className="size-6" aria-hidden />
                    </button>
                    <button type="button" aria-label="Next" onClick={() => go(1)} className="absolute top-1/2 right-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                      <ChevronRight className="size-6" aria-hidden />
                    </button>
                  </>
                )}
              </div>
              {info && (
                <aside aria-label="File details" className="w-72 shrink-0 space-y-3 overflow-y-auto border-l border-white/10 bg-black/40 p-4 text-[13px]">
                  <dl className="space-y-2">
                    {[
                      ["Name", item.name],
                      ["Size", formatBytes(item.size)],
                      ["Type", item.mime],
                      ["Uploaded", formatDateTime(item.createdAt)],
                      ...(item.mediaInfo?.width && item.mediaInfo?.height ? [["Dimensions", `${item.mediaInfo.width} × ${item.mediaInfo.height}`]] : []),
                      ...(item.mediaInfo?.duration ? [["Duration", formatDuration(item.mediaInfo.duration)]] : []),
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs text-white/50">{k}</dt>
                        <dd className="break-words">{v}</dd>
                      </div>
                    ))}
                    <div>
                      <dt className="text-xs text-white/50">SHA-256</dt>
                      <dd className="font-mono text-[11px] break-all text-white/70">{item.sha256}</dd>
                    </div>
                  </dl>
                </aside>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
