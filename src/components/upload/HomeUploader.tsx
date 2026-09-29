"use client";

import { FileUpload } from "@ark-ui/react/file-upload";
import { ChevronDown, FolderUp, ShieldAlert, SlidersHorizontal, UploadCloud } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Feedback";
import { Pop } from "@/components/ui/Overlays";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { DEFAULT_FORM, defaultRetentionLabel, expiryChoices, toUploadOptions, type UploadFormState } from "@/lib/upload/options";
import type { AuthedConfigDto } from "@/lib/types";
import { UploadOptionsForm } from "./UploadOptionsForm";
import { UploadQueue } from "./UploadQueue";
import { useUploadIntake } from "./useUploadIntake";

interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
}

interface Props {
  config: AuthedConfigDto;
  /** When set, uploads land in this folder (file manager context). */
  folderId?: string | null;
  /** Destination folders to choose from. */
  folders?: FolderRow[];
}

function folderLabels(folders: FolderRow[]): Array<{ id: string; label: string }> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const label = (f: FolderRow): string => {
    const parts = [f.name];
    let cur = f.parentId ? byId.get(f.parentId) : undefined;
    for (let i = 0; cur && i < 32; i++) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" / ");
  };
  return folders.map((f) => ({ id: f.id, label: label(f) })).sort((a, b) => a.label.localeCompare(b.label));
}

function optionsSummary(form: UploadFormState, config: AuthedConfigDto): string {
  const parts: string[] = [];
  const choice = expiryChoices(config.limits).find((c) => c.value === form.expiry);
  parts.push(form.expiry === "default" ? defaultRetentionLabel(config.limits) : form.expiry === "never" ? "Never expires" : `Deleted after ${choice?.label.toLowerCase() ?? form.expiry}`);
  if (form.share) parts.push("public link");
  if (form.password) parts.push("password");
  if (form.maxDownloads) parts.push(`${form.maxDownloads} download${form.maxDownloads === "1" ? "" : "s"}`);
  return parts.join(" · ");
}

export function HomeUploader({ config, folderId: fixedFolderId, folders }: Props) {
  const [form, setForm] = useState<UploadFormState>(DEFAULT_FORM);
  const [destination, setDestination] = useState("");
  const folderId = folders ? (destination || null) : fixedFolderId;
  const paused = config.maintenance.enabled && config.maintenance.disableUploads;

  const { api, openFiles, openFolder } = useUploadIntake({
    limits: config.limits,
    blockedExtensions: config.blockedExtensions,
    allowedExtensions: config.allowedExtensions,
    getOptions: () => toUploadOptions(form, { folderId }),
    folderId,
    canUseFolders: true,
    disabled: paused,
  });

  const limits = config.limits;
  return (
    <div className="space-y-4">
      {paused && (
        <ErrorNotice tone="warning">
          <span className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {config.maintenance.message}
          </span>
        </ErrorNotice>
      )}

      <FileUpload.RootProvider value={api}>
        <FileUpload.Dropzone
          disableClick
          className={cn(
            "group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line-strong bg-surface px-6 py-14 text-center transition-colors",
            "data-[dragging]:border-accent data-[dragging]:bg-accent-soft",
            paused && "pointer-events-none opacity-60",
          )}
        >
          <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent group-data-[dragging]:bg-surface">
            <UploadCloud className="size-6" aria-hidden />
          </span>
          <p className="text-base font-semibold text-fg">Drop files here to upload</p>
          <p className="mt-1 text-[13px] text-muted">or paste from the clipboard. Up to {limits.maxFileBytes < 0 ? "any size" : `${formatBytes(limits.maxFileBytes, 0)} per file`}.</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" size="lg" onClick={openFiles} disabled={paused} icon={<UploadCloud className="size-4" aria-hidden />}>
              Select files
            </Button>
            <Button variant="secondary" size="lg" onClick={openFolder} disabled={paused} icon={<FolderUp className="size-4" aria-hidden />}>
              Select folder
            </Button>
          </div>
          <FileUpload.HiddenInput />
        </FileUpload.Dropzone>
      </FileUpload.RootProvider>

      {folders && (
        <div className="flex items-center gap-2.5 text-[13px]">
          <label htmlFor="upload-destination" className="shrink-0 font-medium text-fg">
            Save to
          </label>
          <Select id="upload-destination" value={destination} onChange={(e) => setDestination(e.target.value)} className="max-w-xs">
            <option value="">All files (top level)</option>
            {folderLabels(folders).map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <Pop
          label="Upload options"
          placement="bottom-start"
          className="w-[22rem] p-4"
          trigger={
            <Button variant="ghost" size="sm" icon={<SlidersHorizontal className="size-4" aria-hidden />}>
              <span className="text-muted">{optionsSummary(form, config)}</span>
              <ChevronDown className="size-3.5 text-subtle" aria-hidden />
            </Button>
          }
        >
          <UploadOptionsForm value={form} onChange={setForm} limits={config.limits} />
        </Pop>
        <p className="text-xs text-subtle tnum">
          {limits.quotaBytes < 0 ? "Unlimited storage" : `${formatBytes(limits.quotaBytes, 0)} total`} · {formatBytes(config.usage.usedBytes)} used
        </p>
      </div>

      <UploadQueue />
    </div>
  );
}
