"use client";

import { useFileUpload, type FileUploadFileRejection } from "@ark-ui/react/file-upload";
import { useCallback, useEffect, useRef } from "react";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api-client";
import { extensionOf } from "@/lib/fileTypes";
import { formatBytes } from "@/lib/format";
import type { UploadOptions } from "@/lib/upload/engine";
import { queueFolderUpload } from "@/lib/upload/folders";
import type { LimitsDto } from "@/lib/types";
import { useUploadManager } from "./UploadProvider";

interface IntakeOptions {
  limits: LimitsDto;
  blockedExtensions: string[];
  allowedExtensions: string[];
  /** Called when files are accepted, to build the per-upload options (folder, expiry, password...). */
  getOptions: () => UploadOptions;
  folderId?: string | null;
  canUseFolders: boolean;
  disabled?: boolean;
  onQueued?: (count: number) => void;
}

const REASONS: Record<string, string> = {
  FILE_TOO_LARGE: "is larger than your per-file limit",
  FILE_TOO_SMALL: "is empty",
  FILE_INVALID: "isn't an allowed file type",
  FILE_INVALID_TYPE: "isn't an allowed file type",
  TOO_MANY_FILES: "exceeds the number of files that can be added at once",
};

/**
 * Wires Ark UI's FileUpload (selection, drag & drop, validation) to the app-wide upload manager.
 * Accepted files go straight into the queue; the component's own file list is cleared each time.
 */
export function useUploadIntake(opts: IntakeOptions) {
  const manager = useUploadManager();
  const toast = useToast();
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const onReject = useCallback(
    (rejections: FileUploadFileRejection[]) => {
      const { limits } = optsRef.current;
      const lines = rejections.slice(0, 3).map((r) => {
        const reason = REASONS[r.errors[0]] ?? "can't be uploaded";
        return `${r.file.name} ${reason}${r.errors[0] === "FILE_TOO_LARGE" ? ` (${formatBytes(limits.maxFileBytes)})` : ""}`;
      });
      if (rejections.length > 3) lines.push(`and ${rejections.length - 3} more`);
      toast.error(rejections.length === 1 ? "File not added" : `${rejections.length} files not added`, lines.join(". ") + ".");
    },
    [toast],
  );

  const api = useFileUpload({
    maxFiles: 10_000,
    minFileSize: 1,
    maxFileSize: opts.limits.maxFileBytes,
    disabled: opts.disabled,
    preventDocumentDrop: true,
    validate: (file) => {
      const ext = extensionOf(file.name);
      const { blockedExtensions, allowedExtensions } = optsRef.current;
      if (ext && blockedExtensions.includes(ext)) return ["FILE_INVALID"];
      if (allowedExtensions.length > 0 && !allowedExtensions.includes(ext)) return ["FILE_INVALID"];
      return null;
    },
    onFileReject: ({ files }) => onReject(files),
    onFileAccept: ({ files }) => {
      const o = optsRef.current;
      const uploadOptions = o.getOptions();
      const hasPaths = files.some((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath);
      if (hasPaths && o.canUseFolders) {
        queueFolderUpload(manager, files, o.folderId ?? null, uploadOptions).then(
          ({ queued }) => o.onQueued?.(queued),
          (err) => toast.error("Couldn't upload the folder", errorMessage(err)),
        );
      } else {
        manager.add(files, { ...uploadOptions, ...(o.folderId !== undefined ? { folderId: o.folderId } : {}) });
        o.onQueued?.(files.length);
      }
      // Files now belong to the queue; don't keep them in the picker.
      queueMicrotask(() => api.clearFiles());
    },
  });

  const openFolder = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) return;
      const o = optsRef.current;
      queueFolderUpload(manager, files, o.folderId ?? null, o.getOptions()).then(
        ({ queued }) => o.onQueued?.(queued),
        (err) => toast.error("Couldn't upload the folder", errorMessage(err)),
      );
    };
    input.click();
  }, [manager, toast]);

  // Paste files from the clipboard (screenshots, copied files).
  useEffect(() => {
    if (opts.disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      const o = optsRef.current;
      manager.add(files, { ...o.getOptions(), ...(o.folderId !== undefined ? { folderId: o.folderId } : {}) });
      o.onQueued?.(files.length);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [manager, opts.disabled]);

  return { api, openFiles: () => api.openFilePicker(), openFolder };
}
