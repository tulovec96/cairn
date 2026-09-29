import { File, FileArchive, FileAudio, FileCode2, FileText, FileVideo, Folder, Image as ImageIcon } from "lucide-react";
import type { FileCategory } from "@/lib/fileTypes";
import { cn } from "@/lib/cn";

const MAP: Record<FileCategory, { icon: typeof File; tone: string }> = {
  image: { icon: ImageIcon, tone: "bg-accent-soft text-accent" },
  video: { icon: FileVideo, tone: "bg-accent-soft text-accent" },
  audio: { icon: FileAudio, tone: "bg-accent-soft text-accent" },
  document: { icon: FileText, tone: "bg-surface-3 text-muted" },
  code: { icon: FileCode2, tone: "bg-surface-3 text-muted" },
  archive: { icon: FileArchive, tone: "bg-warning-soft text-warning" },
  other: { icon: File, tone: "bg-surface-3 text-subtle" },
};

export function FileIcon({ category, size = "md", className }: { category: FileCategory; size?: "sm" | "md" | "lg"; className?: string }) {
  const { icon: Icon, tone } = MAP[category] ?? MAP.other;
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md",
        size === "sm" ? "size-7 [&>svg]:size-3.5" : size === "md" ? "size-8 [&>svg]:size-4" : "size-12 rounded-lg [&>svg]:size-6",
        tone,
        className,
      )}
    >
      <Icon />
    </span>
  );
}

export function FolderIcon({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning",
        size === "sm" ? "size-7 [&>svg]:size-3.5" : size === "md" ? "size-8 [&>svg]:size-4" : "size-12 rounded-lg [&>svg]:size-6",
        className,
      )}
    >
      <Folder />
    </span>
  );
}
