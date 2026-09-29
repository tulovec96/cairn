import { Archive, ArchiveRestore, CalendarClock, Copy, CopyPlus, Download, ExternalLink, FolderInput, Info, Link2, Pencil, Star, StarOff, Tag, Trash2, Users } from "lucide-react";
import type { MenuEntry } from "@/components/ui/Menu";
import type { FileActions } from "./useFileActions";
import type { Item } from "./types";

export interface MenuPermissions {
  write: boolean;
  delete: boolean;
  share: boolean;
  /** Sharing a folder with other accounts (personal files only). */
  people?: boolean;
}

interface MenuCtx {
  actions: FileActions;
  onDetails: (fileId: string) => void;
  can?: MenuPermissions;
}

const ALL: MenuPermissions = { write: true, delete: true, share: true };

/** One menu definition shared by the row "⋯" button and the right-click context menu. Entries the role can't use are left out. */
export function itemMenu(item: Item, { actions, onDetails, can = ALL }: MenuCtx): MenuEntry[] {
  const sep: MenuEntry = { type: "separator" };
  const clean = (entries: Array<MenuEntry | false>): MenuEntry[] => {
    const out: MenuEntry[] = [];
    for (const e of entries) {
      if (!e) continue;
      if (e.type === "separator" && (out.length === 0 || out[out.length - 1].type === "separator")) continue;
      out.push(e);
    }
    while (out.length && out[out.length - 1].type === "separator") out.pop();
    return out;
  };

  if (item.kind === "folder") {
    const f = item.folder;
    return clean([
      { value: "open", label: "Open", icon: <ExternalLink />, onSelect: () => actions.openItem(item) },
      { value: "download", label: "Download as ZIP", icon: <Download />, onSelect: () => actions.download([item]) },
      sep,
      can.share && { value: "share", label: f.share ? "Manage sharing…" : "Share…", icon: <Link2 />, onSelect: () => actions.share(item) },
      can.share && !!f.share && { value: "copy", label: "Copy link", icon: <Copy />, onSelect: () => actions.copyLink(item) },
      !!can.people && { value: "people", label: "Share with people…", icon: <Users />, onSelect: () => actions.people(item) },
      sep,
      can.write && { value: "rename", label: "Rename…", icon: <Pencil />, onSelect: () => actions.rename(item) },
      can.write && { value: "move", label: "Move…", icon: <FolderInput />, onSelect: () => actions.move([item]) },
      { value: "fav", label: f.favorite ? "Remove from favorites" : "Add to favorites", icon: f.favorite ? <StarOff /> : <Star />, onSelect: () => void actions.setFavorite([item], !f.favorite) },
      sep,
      can.delete && { value: "delete", label: "Move to trash", icon: <Trash2 />, danger: true, onSelect: () => void actions.remove([item]) },
    ]);
  }
  const f = item.file;
  const downloadable = f.status === "available";
  return clean([
    { value: "details", label: "Details & preview", icon: <Info />, onSelect: () => onDetails(f.id) },
    { value: "download", label: "Download", icon: <Download />, disabled: !downloadable, onSelect: () => actions.download([item]) },
    sep,
    can.share && { value: "share", label: f.share ? "Manage sharing…" : "Share…", icon: <Link2 />, disabled: f.status === "quarantined", onSelect: () => actions.share(item) },
    can.share && !!f.share && { value: "copy", label: "Copy link", icon: <Copy />, onSelect: () => actions.copyLink(item) },
    sep,
    can.write && { value: "rename", label: "Rename…", icon: <Pencil />, onSelect: () => actions.rename(item) },
    can.write && { value: "move", label: "Move…", icon: <FolderInput />, onSelect: () => actions.move([item]) },
    can.write && { value: "copyto", label: "Copy to…", icon: <CopyPlus />, disabled: !downloadable, onSelect: () => actions.copyTo([item]) },
    can.write && { value: "tag", label: "Tags…", icon: <Tag />, onSelect: () => actions.tag([item]) },
    { value: "fav", label: f.favorite ? "Remove from favorites" : "Add to favorites", icon: f.favorite ? <StarOff /> : <Star />, onSelect: () => void actions.setFavorite([item], !f.favorite) },
    can.write && { value: "expiry", label: "Change expiration…", icon: <CalendarClock />, onSelect: () => actions.expiry([item]) },
    can.write && (f.archivedAt ? { value: "archive", label: "Restore from archive", icon: <ArchiveRestore />, onSelect: () => void actions.setArchived([item], false) } : { value: "archive", label: "Archive", icon: <Archive />, onSelect: () => void actions.setArchived([item], true) }),
    sep,
    can.delete && { value: "delete", label: "Move to trash", icon: <Trash2 />, danger: true, onSelect: () => void actions.remove([item]) },
  ]);
}
