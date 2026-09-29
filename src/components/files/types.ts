import type { FileDto, FolderDto } from "@/lib/types";

export type Item = { kind: "file"; file: FileDto } | { kind: "folder"; folder: FolderDto };

export const keyOf = (item: Item): string => (item.kind === "file" ? `f:${item.file.id}` : `d:${item.folder.id}`);
export const nameOf = (item: Item): string => (item.kind === "file" ? item.file.name : item.folder.name);
export const idOf = (item: Item): string => (item.kind === "file" ? item.file.id : item.folder.id);

export function splitItems(items: Item[]): { fileIds: string[]; folderIds: string[] } {
  return {
    fileIds: items.filter((i): i is Extract<Item, { kind: "file" }> => i.kind === "file").map((i) => i.file.id),
    folderIds: items.filter((i): i is Extract<Item, { kind: "folder" }> => i.kind === "folder").map((i) => i.folder.id),
  };
}

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
}
