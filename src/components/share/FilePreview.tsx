"use client";

import { FileViewer, type FileViewerProps } from "@/components/viewers/FileViewer";

/** Kept as the name the rest of the app imports; all rendering lives in the viewers. */
export function FilePreview(props: FileViewerProps) {
  return <FileViewer {...props} />;
}
