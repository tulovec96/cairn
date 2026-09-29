"use client";

import { Maximize, Minimize, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/Overlays";
import { cn } from "@/lib/cn";

interface Props {
  src: string;
  alt: string;
  className?: string;
  /** Rendered over the image (navigation arrows in the lightbox). */
  children?: React.ReactNode;
  height?: string;
}

const MIN = 0.25;
const MAX = 8;

/** Zoom (wheel, buttons, +/-), pan by dragging, rotate and fullscreen. Keyboard accessible. */
export function ImageViewer({ src, alt, className, children, height = "32rem" }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [full, setFull] = useState(false);

  const setZ = useCallback((z: number) => {
    const next = Math.min(MAX, Math.max(MIN, z));
    setZoom(next);
    if (next <= 1) setPan({ x: 0, y: 0 });
  }, []);
  const reset = () => {
    setZoom(1);
    setRot(0);
    setPan({ x: 0, y: 0 });
  };

  const toggleFull = async () => {
    const el = box.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
      setFull(!document.fullscreenElement);
    } catch {
      /* fullscreen not available */
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey && zoom === 1 && Math.abs(e.deltaY) < 1) return;
    setZ(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  };
  const onDown = (e: PointerEvent) => {
    if (zoom <= 1) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ x: e.clientX, y: e.clientY, px: pan.x, py: pan.y });
  };
  const onMove = (e: PointerEvent) => {
    if (drag) setPan({ x: drag.px + e.clientX - drag.x, y: drag.py + e.clientY - drag.y });
  };

  return (
    <div
      ref={box}
      className={cn("relative overflow-hidden rounded-lg border border-line bg-surface-2 outline-none", className)}
      style={{ height: full ? "100dvh" : height }}
      tabIndex={0}
      role="group"
      aria-label={`Image viewer: ${alt}`}
      onKeyDown={(e) => {
        if (e.key === "+" || e.key === "=") setZ(zoom * 1.25);
        else if (e.key === "-") setZ(zoom / 1.25);
        else if (e.key === "0") reset();
        else if (e.key.toLowerCase() === "r") setRot((r) => (r + 90) % 360);
        else if (e.key.toLowerCase() === "f") void toggleFull();
      }}
    >
      <div
        className={cn("flex size-full items-center justify-center", zoom > 1 ? (drag ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in")}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onDoubleClick={() => setZ(zoom > 1 ? 1 : 2)}
        style={{ touchAction: zoom > 1 ? "none" : "auto" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- streamed from an authenticated, sanitizing preview endpoint */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full object-contain select-none"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rot}deg)`, transition: drag ? "none" : "transform 120ms ease-out" }}
        />
      </div>
      {children}
      <div className="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-lg border border-line bg-surface/95 p-0.5 shadow-pop backdrop-blur">
        <Tip label="Zoom out (−)">
          <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => setZ(zoom / 1.25)} disabled={zoom <= MIN}>
            <ZoomOut className="size-4" aria-hidden />
          </Button>
        </Tip>
        <button type="button" onClick={reset} aria-label="Reset zoom and rotation" className="h-8 min-w-12 rounded px-1.5 text-xs font-medium text-muted hover:bg-surface-2 tnum">
          {Math.round(zoom * 100)}%
        </button>
        <Tip label="Zoom in (+)">
          <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => setZ(zoom * 1.25)} disabled={zoom >= MAX}>
            <ZoomIn className="size-4" aria-hidden />
          </Button>
        </Tip>
        <Tip label="Rotate (R)">
          <Button variant="ghost" size="icon-sm" aria-label="Rotate 90 degrees" onClick={() => setRot((r) => (r + 90) % 360)}>
            <RotateCw className="size-4" aria-hidden />
          </Button>
        </Tip>
        <Tip label={full ? "Exit fullscreen (F)" : "Fullscreen (F)"}>
          <Button variant="ghost" size="icon-sm" aria-label={full ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFull()}>
            {full ? <Minimize className="size-4" aria-hidden /> : <Maximize className="size-4" aria-hidden />}
          </Button>
        </Tip>
      </div>
    </div>
  );
}
