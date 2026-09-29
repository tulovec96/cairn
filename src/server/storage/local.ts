import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { ByteRange, StorageHealth, StorageProvider } from "./types";

const KEY_RE = /^[a-z0-9][a-z0-9_\-./]{0,200}$/;

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Resolve a key to an absolute path, refusing anything that could escape the storage root. */
  private resolve(key: string): string {
    if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) {
      throw new Error("Invalid storage key");
    }
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async putFile(key: string, sourcePath: string): Promise<void> {
    const dest = this.resolve(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fsp.rename(sourcePath, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      await fsp.copyFile(sourcePath, dest);
      await fsp.unlink(sourcePath).catch(() => undefined);
    }
  }

  async putStream(key: string, stream: Readable): Promise<{ size: number }> {
    const dest = this.resolve(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.part`;
    try {
      await pipeline(stream, fs.createWriteStream(tmp));
      await fsp.rename(tmp, dest);
    } catch (err) {
      await fsp.unlink(tmp).catch(() => undefined);
      throw err;
    }
    const st = await fsp.stat(dest);
    return { size: st.size };
  }

  createReadStream(key: string, range?: ByteRange): Readable {
    const full = this.resolve(key);
    return fs.createReadStream(full, range ? { start: range.start, end: range.end } : undefined);
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const st = await fsp.stat(this.resolve(key));
      return st.isFile() ? { size: st.size } : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const src = this.resolve(fromKey);
    const dest = this.resolve(toKey);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest, fs.constants.COPYFILE_FICLONE);
  }

  async delete(key: string): Promise<void> {
    try {
      await fsp.unlink(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async *walk(): AsyncGenerator<{ key: string; size: number; mtimeMs: number }> {
    const stack = [this.root];
    while (stack.length) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile() && !e.name.endsWith(".part") && e.name !== ".health") {
          const st = await fsp.stat(full);
          yield { key: path.relative(this.root, full).split(path.sep).join("/"), size: st.size, mtimeMs: st.mtimeMs };
        }
      }
    }
  }

  async health(): Promise<StorageHealth> {
    try {
      await fsp.mkdir(this.root, { recursive: true });
      const probe = path.join(this.root, ".health");
      await fsp.writeFile(probe, String(Date.now()));
      await fsp.unlink(probe);
      const s = await fsp.statfs(this.root);
      return { provider: this.name, ok: true, totalBytes: Number(s.blocks) * Number(s.bsize), freeBytes: Number(s.bavail) * Number(s.bsize) };
    } catch (err) {
      return { provider: this.name, ok: false, totalBytes: null, freeBytes: null, detail: (err as Error).message };
    }
  }
}
