"use client";

import { Maximize, Music2 } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { PreviewKind } from "@/lib/fileTypes";
import { formatDuration } from "@/lib/format";
import type { MediaInfo } from "@/lib/types";
import { ImageViewer } from "./ImageViewer";
import { TextViewer } from "./TextViewer";

export interface FileViewerProps {
  /** Same-origin URL of the inline-safe rendition (never the raw upload). */
  src: string;
  kind: PreviewKind;
  name: string;
  size: number;
  extension?: string;
  mediaInfo?: MediaInfo | null;
  maxTextBytes?: number;
  className?: string;
  /** Poster image for video. */
  poster?: string;
}

/**
 * The universal preview: images and SVG (zoom/pan/rotate/fullscreen), video and audio players, the browser's PDF
 * viewer, and text in the format that suits it (Markdown, JSON, CSV, logs, highlighted code).
 */
export function FileViewer({ src, kind, name, size, extension = "", mediaInfo, maxTextBytes, className, poster }: FileViewerProps) {
  const pdfRef = useRef<HTMLDivElement>(null);
  const frame = cn("overflow-hidden rounded-lg border border-line bg-surface-2", className);
  switch (kind) {
    case "image":
    case "svg":
      return <ImageViewer src={src} alt={`Preview of ${name}`} className={className} />;
    case "video":
      return (
        <div className={cn(frame, "bg-black")}>
          <video src={src} poster={poster} controls preload="metadata" playsInline className="max-h-[32rem] w-full" aria-label={`Video: ${name}`} />
        </div>
      );
    case "audio":
      return (
        <div className={cn(frame, "flex items-center gap-4 p-4")}>
          <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Music2 className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{name}</p>
            {mediaInfo?.duration ? <p className="mb-1.5 text-xs text-muted tnum">{formatDuration(mediaInfo.duration)}</p> : null}
            <audio src={src} controls preload="metadata" className="w-full" aria-label={`Audio: ${name}`} />
          </div>
        </div>
      );
    case "pdf":
      return (
        <div ref={pdfRef} className={cn(frame, "relative")}>
          <iframe src={src} title={`PDF: ${name}`} className="h-[36rem] w-full bg-white" />
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-3 bottom-3"
            icon={<Maximize className="size-3.5" aria-hidden />}
            onClick={() => void pdfRef.current?.requestFullscreen?.().catch(() => undefined)}
          >
            Fullscreen
          </Button>
        </div>
      );
    case "text":
      return (
        <div className={cn(frame, "bg-surface")}>
          <TextViewer src={src} size={size} extension={extension} name={name} maxBytes={maxTextBytes} />
        </div>
      );
  }
}
