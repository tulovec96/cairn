import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import fs from "node:fs";
import sharp, { type Sharp } from "sharp";
import { db } from "../db";
import { newStorageKey } from "../ids";
import { storage } from "../storage";
import type { MediaInfo } from "@/lib/types";

const RASTER = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/tiff"]);
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;

export const THUMB_SIZES = { s: 160, m: 480, l: 1280 } as const;
export type ThumbSize = keyof typeof THUMB_SIZES;

export const thumbKey = (base: string, size: ThumbSize) => `${base}.${size}`;

async function putBuffer(key: string, buf: Buffer) {
  await storage().putStream(key, Readable.from(buf));
}

async function writeThumbs(base: string, input: Sharp): Promise<void> {
  const src = await input.rotate().toBuffer();
  for (const [size, px] of Object.entries(THUMB_SIZES) as Array<[ThumbSize, number]>) {
    const buf = await sharp(src).resize(px, px, { fit: "inside", withoutEnlargement: true }).webp({ quality: size === "l" ? 80 : 72 }).toBuffer();
    await putBuffer(thumbKey(base, size), buf);
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(cmd, ["-version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

const g = globalThis as unknown as { __cairnFfmpeg?: Promise<boolean> };
const hasFfmpeg = () => (g.__cairnFfmpeg ??= commandExists("ffmpeg").then((a) => a && commandExists("ffprobe")));

export async function mediaToolsAvailable(): Promise<{ ffmpeg: boolean }> {
  return { ffmpeg: await hasFfmpeg() };
}

function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", reject);
    p.on("exit", (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited with ${code}`));
    });
  });
}

/** MP4/MOV duration straight from the movie header (no external tools needed). */
async function mp4Duration(storageKey: string): Promise<number | null> {
  try {
    const stat = await storage().stat(storageKey);
    if (!stat) return null;
    const read = async (start: number, len: number) => {
      const chunks: Buffer[] = [];
      for await (const c of storage().createReadStream(storageKey, { start, end: Math.min(stat.size - 1, start + len - 1) })) chunks.push(c as Buffer);
      return Buffer.concat(chunks);
    };
    // Walk top-level boxes; "moov" is usually near the start or the end.
    let offset = 0;
    for (let i = 0; i < 64 && offset < stat.size; i++) {
      const head = await read(offset, 16);
      if (head.length < 8) return null;
      let size = head.readUInt32BE(0);
      const type = head.toString("latin1", 4, 8);
      if (size === 1) size = Number(head.readBigUInt64BE(8));
      if (size < 8) return null;
      if (type === "moov") {
        const moov = await read(offset, Math.min(size, 4 * 1024 * 1024));
        const idx = moov.indexOf("mvhd", 0, "latin1");
        if (idx < 0) return null;
        const v = moov[idx + 4];
        const timescale = v === 1 ? moov.readUInt32BE(idx + 4 + 4 + 16) : moov.readUInt32BE(idx + 4 + 4 + 8);
        const dur = v === 1 ? Number(moov.readBigUInt64BE(idx + 4 + 4 + 20)) : moov.readUInt32BE(idx + 4 + 4 + 12);
        return timescale ? dur / timescale : null;
      }
      offset += size;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** WAV duration from its header. */
async function wavDuration(storageKey: string): Promise<number | null> {
  try {
    const chunks: Buffer[] = [];
    for await (const c of storage().createReadStream(storageKey, { start: 0, end: 4095 })) chunks.push(c as Buffer);
    const b = Buffer.concat(chunks);
    if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") return null;
    const byteRate = b.readUInt32LE(28);
    const dataIdx = b.indexOf("data", 12, "latin1");
    if (!byteRate || dataIdx < 0) return null;
    return b.readUInt32LE(dataIdx + 4) / byteRate;
  } catch {
    return null;
  }
}

/** Thumbnails, dimensions and durations. Everything here is best effort: failure never affects the file itself. */
export async function processMedia(fileId: string): Promise<void> {
  const file = await db.file.findUnique({ where: { id: fileId } });
  if (!file || file.deletedAt || file.status !== "available") return;
  const info: MediaInfo = file.mediaInfo ? JSON.parse(file.mediaInfo) : {};
  let thumbnailKey = file.thumbnailKey;

  if (RASTER.has(file.mime) && Number(file.size) <= MAX_SOURCE_BYTES && !thumbnailKey) {
    const transformer = sharp({ failOn: "none", limitInputPixels: 120_000_000, sequentialRead: true });
    storage().createReadStream(file.storageKey).pipe(transformer);
    try {
      const base = `${newStorageKey()}.thumb`;
      const meta = await transformer.clone().metadata();
      info.width ??= meta.width;
      info.height ??= meta.height;
      await writeThumbs(base, transformer);
      thumbnailKey = base;
    } catch {
      /* corrupt or unsupported image: no thumbnail */
    }
  } else if (file.category === "video" || file.category === "audio") {
    const ffmpeg = await hasFfmpeg();
    const ext = file.extension || "bin";
    if (ffmpeg && Number(file.size) <= 4 * 1024 ** 3) {
      const tmp = path.join(os.tmpdir(), `cairn-media-${fileId}.${ext}`);
      try {
        await pipeline(storage().createReadStream(file.storageKey), fs.createWriteStream(tmp));
        const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", tmp]));
        const dur = Number(probe.format?.duration);
        if (Number.isFinite(dur)) info.duration = dur;
        const v = (probe.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === "video");
        if (v) {
          info.width = v.width;
          info.height = v.height;
        }
        if (file.category === "video" && !thumbnailKey) {
          const poster = `${tmp}.jpg`;
          await run("ffmpeg", ["-y", "-v", "error", "-ss", String(Math.min(3, Math.max(0, (info.duration ?? 2) / 4))), "-i", tmp, "-frames:v", "1", poster]);
          const base = `${newStorageKey()}.thumb`;
          await writeThumbs(base, sharp(await fsp.readFile(poster)));
          thumbnailKey = base;
          await fsp.unlink(poster).catch(() => undefined);
        }
      } catch {
        /* keep whatever we learned */
      } finally {
        await fsp.unlink(tmp).catch(() => undefined);
      }
    } else if (info.duration == null) {
      const d = /^(mp4|m4v|mov|m4a)$/.test(ext) ? await mp4Duration(file.storageKey) : ext === "wav" ? await wavDuration(file.storageKey) : null;
      if (d) info.duration = d;
    }
  }

  await db.file.updateMany({
    where: { id: fileId },
    data: { mediaInfo: Object.keys(info).length ? JSON.stringify(info) : file.mediaInfo, ...(thumbnailKey && !file.thumbnailKey ? { thumbnailKey } : {}) },
  });
}
