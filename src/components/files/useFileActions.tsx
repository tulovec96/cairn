"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useConfirm } from "@/components/ui/Confirm";
import { copyText } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage, shareLink } from "@/lib/api-client";
import { pluralize } from "@/lib/format";
import type { LimitsDto, ShareDto } from "@/lib/types";
import { ArchiveDialog, ExpiryDialog, MoveDialog, NewFolderDialog, RenameDialog, ShareDialog, ShareResultsDialog } from "./dialogs";
import { FolderPeopleDialog } from "./FolderPeopleDialog";
import { BatchRenameDialog, TagDialog } from "./toolDialogs";
import { idOf, nameOf, splitItems, type Item } from "./types";

type DialogState =
  | { type: "rename"; item: Item }
  | { type: "move"; items: Item[]; mode: "move" | "copy" }
  | { type: "tag"; items: Item[] }
  | { type: "batchRename"; items: Item[] }
  | { type: "expiry"; items: Item[] }
  | { type: "share"; item: Item }
  | { type: "people"; folderId: string; name: string }
  | { type: "shareResults"; shares: ShareDto[]; failed: number }
  | { type: "archive"; items: Item[] }
  | { type: "newFolder" }
  | null;

export interface FileActions {
  openItem: (item: Item) => void;
  download: (items: Item[]) => void;
  copyLink: (item: Item) => void;
  share: (item: Item) => void;
  people: (item: Item) => void;
  shareMany: (items: Item[]) => Promise<void>;
  rename: (item: Item) => void;
  move: (items: Item[]) => void;
  copyTo: (items: Item[]) => void;
  tag: (items: Item[]) => void;
  batchRename: (items: Item[]) => void;
  setArchived: (items: Item[], value: boolean) => Promise<void>;
  moveInto: (items: Item[], folderId: string | null, folderName?: string) => Promise<void>;
  expiry: (items: Item[]) => void;
  setFavorite: (items: Item[], value: boolean) => Promise<void>;
  remove: (items: Item[]) => Promise<void>;
  newFolder: () => void;
}

interface Options {
  limits: LimitsDto;
  currentFolderId: string | null;
  onChanged: () => void;
  onOpenFile: (fileId: string) => void;
  onOpenFolder: (folderId: string) => void;
}

/** All file/folder operations, plus the dialogs they need. Render `dialogs` once next to the list. */
export function useFileActions(opts: Options): { actions: FileActions; dialogs: ReactNode } {
  const { limits, currentFolderId, onChanged, onOpenFile, onOpenFolder } = opts;
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>(null);
  const close = useCallback(() => setDialog(null), []);

  const download = useCallback(
    (items: Item[]) => {
      if (items.length === 1 && items[0].kind === "file") {
        const a = document.createElement("a");
        a.href = `/api/v1/files/${items[0].file.id}/download`;
        a.download = items[0].file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      setDialog({ type: "archive", items });
    },
    [],
  );

  const actions = useMemo<FileActions>(
    () => ({
      openItem: (item) => (item.kind === "folder" ? onOpenFolder(item.folder.id) : onOpenFile(item.file.id)),
      download,
      copyLink: async (item) => {
        const share = item.kind === "file" ? item.file.share : item.folder.share;
        if (!share) return setDialog({ type: "share", item });
        const ok = await copyText(shareLink(share.token));
        if (ok) toast.success("Link copied");
        else toast.error("Couldn't copy automatically", shareLink(share.token));
      },
      share: (item) => setDialog({ type: "share", item }),
      people: (item) => item.kind === "folder" && setDialog({ type: "people", folderId: item.folder.id, name: item.folder.name }),
      shareMany: async (items) => {
        const { fileIds, folderIds } = splitItems(items);
        try {
          const res = await api<{ done: number; failed: unknown[]; shares?: ShareDto[] }>("/api/v1/bulk", { method: "POST", body: { action: "share", fileIds, folderIds } });
          if (res.shares?.length) setDialog({ type: "shareResults", shares: res.shares, failed: res.failed.length });
          else toast.error("Nothing could be shared");
          onChanged();
        } catch (err) {
          toast.error("Couldn't create the links", errorMessage(err));
        }
      },
      rename: (item) => setDialog({ type: "rename", item }),
      move: (items) => setDialog({ type: "move", items, mode: "move" }),
      copyTo: (items) => setDialog({ type: "move", items, mode: "copy" }),
      tag: (items) => setDialog({ type: "tag", items }),
      batchRename: (items) => setDialog({ type: "batchRename", items }),
      setArchived: async (items, value) => {
        const { fileIds } = splitItems(items);
        try {
          await api("/api/v1/bulk", { method: "POST", body: { action: value ? "archive" : "unarchive", fileIds } });
          toast.success(value ? `Archived ${pluralize(fileIds.length, "file")}` : `Restored ${pluralize(fileIds.length, "file")} from the archive`);
          onChanged();
        } catch (err) {
          toast.error("Couldn't change the archive", errorMessage(err));
        }
      },
      moveInto: async (items, folderId, folderName) => {
        const { fileIds, folderIds } = splitItems(items);
        try {
          const res = await api<{ done: number; failed: Array<{ message: string }> }>("/api/v1/bulk", { method: "POST", body: { action: "move", fileIds, folderIds, targetFolderId: folderId } });
          if (res.failed.length) toast.error("Some items couldn't be moved", res.failed[0].message);
          else toast.success(`Moved ${pluralize(res.done, "item")}${folderName ? ` to “${folderName}”` : ""}`);
          onChanged();
        } catch (err) {
          toast.error("Couldn't move", errorMessage(err));
        }
      },
      expiry: (items) => setDialog({ type: "expiry", items }),
      newFolder: () => setDialog({ type: "newFolder" }),
      setFavorite: async (items, value) => {
        const { fileIds, folderIds } = splitItems(items);
        try {
          await api("/api/v1/bulk", { method: "POST", body: { action: value ? "favorite" : "unfavorite", fileIds, folderIds } });
          toast.success(value ? `Added ${pluralize(items.length, "item")} to favorites` : "Removed from favorites");
          onChanged();
        } catch (err) {
          toast.error("Couldn't update favorites", errorMessage(err));
        }
      },
      remove: async (items) => {
        const { fileIds, folderIds } = splitItems(items);
        const single = items.length === 1 ? `"${nameOf(items[0])}"` : pluralize(items.length, "item");
        const ok = await confirm(
          { title: `Move ${single} to trash?`, description: folderIds.length ? "Folders are moved with everything inside them. You can restore them from the trash." : "You can restore it from the trash until it is emptied.", confirmLabel: "Move to trash", tone: "danger" },
        );
        if (!ok) return;
        try {
          const res = await api<{ done: number; trashIds?: string[] }>("/api/v1/bulk", { method: "POST", body: { action: "delete", fileIds, folderIds } });
          onChanged();
          if (!res.trashIds?.length) {
            toast.success(`Deleted ${pluralize(res.done, "file")}`);
          } else {
            toast.toast({
              title: `Moved ${pluralize(res.done, "item")} to trash`,
              tone: "success",
              duration: 8000,
              action: {
                label: "Undo",
                onClick: () => {
                  api("/api/v1/bulk", { method: "POST", body: { action: "restore", trashIds: res.trashIds } }).then(
                    () => {
                      toast.success("Restored");
                      onChanged();
                    },
                    (err) => toast.error("Couldn't restore", errorMessage(err)),
                  );
                },
              },
            });
          }
        } catch (err) {
          toast.error("Couldn't delete", errorMessage(err));
        }
      },
    }),
    [confirm, download, onChanged, onOpenFile, onOpenFolder, toast],
  );

  const dialogs = (
    <>
      {dialog?.type === "rename" && <RenameDialog item={dialog.item} onClose={close} onDone={onChanged} />}
      {dialog?.type === "newFolder" && <NewFolderDialog parentId={currentFolderId} onClose={close} onDone={onChanged} />}
      {dialog?.type === "tag" && <TagDialog items={dialog.items} onClose={close} onDone={onChanged} />}
      {dialog?.type === "batchRename" && <BatchRenameDialog items={dialog.items} onClose={close} onDone={onChanged} />}
      {dialog?.type === "move" && (
        <MoveDialog
          items={dialog.items}
          mode={dialog.mode}
          onClose={close}
          onDone={() => {
            onChanged();
            router.refresh();
          }}
        />
      )}
      {dialog?.type === "expiry" && <ExpiryDialog items={dialog.items} limits={limits} onClose={close} onDone={onChanged} />}
      {dialog?.type === "share" && <ShareDialog target={{ kind: dialog.item.kind, id: idOf(dialog.item), name: nameOf(dialog.item) }} onClose={close} onChanged={onChanged} />}
      {dialog?.type === "people" && <FolderPeopleDialog folderId={dialog.folderId} name={dialog.name} onClose={close} />}
      {dialog?.type === "shareResults" && <ShareResultsDialog shares={dialog.shares} failed={dialog.failed} onClose={close} />}
      {dialog?.type === "archive" && <ArchiveDialog items={dialog.items} onClose={close} />}
    </>
  );

  return { actions, dialogs };
}
