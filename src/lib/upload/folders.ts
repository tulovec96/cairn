import { ApiClientError, api } from "../api-client";
import type { UploadManager, UploadOptions } from "./engine";

interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
}

/**
 * Uploads a picked directory: recreates its folder structure under `baseFolderId` (reusing folders that
 * already exist) and queues every file into the matching folder.
 */
export async function queueFolderUpload(manager: UploadManager, files: File[], baseFolderId: string | null, options: UploadOptions): Promise<{ queued: number }> {
  const withPaths = files.filter((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath);
  if (!withPaths.length) {
    manager.add(files, { ...options, folderId: baseFolderId });
    return { queued: files.length };
  }
  const existing = (await api<{ folders: FolderRow[] }>("/api/v1/folders")).folders;
  const index = new Map<string, string>();
  for (const f of existing) index.set(`${f.parentId ?? "root"}/${f.name.toLowerCase()}`, f.id);

  const ensure = async (segments: string[]): Promise<string | null> => {
    let parent = baseFolderId;
    for (const name of segments) {
      const key = `${parent ?? "root"}/${name.toLowerCase()}`;
      let id = index.get(key);
      if (!id) {
        try {
          const created = await api<{ folder: { id: string } }>("/api/v1/folders", { method: "POST", body: { name, parentId: parent } });
          id = created.folder.id;
        } catch (err) {
          if (err instanceof ApiClientError && err.status === 409) {
            const refreshed = (await api<{ folders: FolderRow[] }>("/api/v1/folders")).folders;
            id = refreshed.find((f) => f.parentId === parent && f.name.toLowerCase() === name.toLowerCase())?.id;
          }
          if (!id) throw err;
        }
        index.set(key, id);
      }
      parent = id;
    }
    return parent;
  };

  const cache = new Map<string, string | null>();
  for (const file of withPaths) {
    const rel = (file as File & { webkitRelativePath: string }).webkitRelativePath;
    const dirs = rel.split("/").slice(0, -1);
    const dirKey = dirs.join("/");
    if (!cache.has(dirKey)) cache.set(dirKey, await ensure(dirs));
    manager.addOne(file, { ...options, folderId: cache.get(dirKey) ?? null });
  }
  return { queued: withPaths.length };
}
