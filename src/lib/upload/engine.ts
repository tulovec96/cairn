import { ApiClientError, api, toApiError } from "../api-client";
import type { FileDto, UploadSessionDto } from "../types";

export type UploadStatus =
  | "waiting"
  | "uploading"
  | "paused"
  | "hashing"
  | "finalizing"
  | "processing"
  | "scanning"
  | "complete"
  | "failed"
  | "quarantined"
  | "cancelled"
  | "retrying";

export interface UploadOptions {
  folderId?: string | null;
  share?: boolean;
  /** undefined = no expiry (bounded by the plan), null = never, ISO string = explicit */
  expiresAt?: string | null;
  password?: string | null;
  maxDownloads?: number | null;
  /** Upload the content as a new version of this file. */
  replaceFileId?: string | null;
  /** Send through a file request or portal: no account, authenticated by a per-upload key. */
  request?: { token: string; label?: string | null };
}

export interface UploadItem {
  id: string;
  file: File;
  name: string;
  size: number;
  mime: string;
  status: UploadStatus;
  uploadedBytes: number;
  progress: number;
  speed: number;
  eta: number | null;
  error: string | null;
  errorCode: string | null;
  attempt: number;
  serverId: string | null;
  /** Per-upload credential for file-request uploads (never used for account uploads). */
  uploadKey: string | null;
  resumed: boolean;
  result: FileDto | null;
  shareUrl: string | null;
  options: UploadOptions;
  addedAt: number;
  finishedAt: number | null;
}

export interface EngineConfig {
  chunkConcurrency: number;
  fileConcurrency: number;
  /** Files up to this size also get a whole-file SHA-256 computed in the browser. */
  clientHashLimit: number;
}

const DEFAULT_CONFIG: EngineConfig = { chunkConcurrency: 3, fileConcurrency: 2, clientHashLimit: 128 * 1024 * 1024 };
const MAX_CHUNK_ATTEMPTS = 6;
const POLL_MS = 800;
const STORE_KEY = "cairn:uploads:v2";
const SPEED_WINDOW_MS = 4000;

/** What survives a page reload: enough to offer "resume" when the person picks the same file again. */
export interface StoredUpload {
  uploadId: string;
  uploadKey: string | null;
  requestToken: string | null;
  name: string;
  size: number;
  folderId: string | null;
  savedAt: number;
}

type Listener = () => void;
type CompleteListener = (item: UploadItem) => void;

class AbortedError extends Error {
  constructor(readonly reason: "pause" | "cancel") {
    super(reason);
  }
}

interface Runtime {
  controllers: Set<XMLHttpRequest>;
  inFlight: Map<number, number>; // chunk index -> bytes sent so far
  confirmedBytes: number;
  samples: Array<{ t: number; bytes: number }>;
  stop: null | "pause" | "cancel";
  running: boolean;
  wake: (() => void) | null;
}

export function fingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function readStore(): Record<string, StoredUpload> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Interrupted uploads that aren't part of the current queue (so they were cut off by a reload or a closed tab). */
export function listInterrupted(activeFingerprints: Set<string>): Array<StoredUpload & { fingerprint: string }> {
  const store = readStore();
  return Object.entries(store)
    .filter(([fp]) => !activeFingerprints.has(fp))
    .map(([fingerprint, v]) => ({ ...v, fingerprint }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function dropInterrupted(fingerprint: string) {
  const store = readStore();
  delete store[fingerprint];
  writeStore(store);
}

function writeStore(store: Record<string, StoredUpload>) {
  try {
    const cutoff = Date.now() - 7 * 86400_000;
    for (const k of Object.keys(store)) if (store[k].savedAt < cutoff) delete store[k];
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    window.dispatchEvent(new Event("cairn:uploads-store"));
  } catch {
    /* storage unavailable: resuming after a reload just won't be possible */
  }
}

async function sha256Hex(data: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class UploadManager {
  private items: UploadItem[] = [];
  private runtime = new Map<string, Runtime>();
  private listeners = new Set<Listener>();
  private completeListeners = new Set<CompleteListener>();
  private config: EngineConfig = DEFAULT_CONFIG;
  private activeSlots = 0;
  private emitScheduled = false;
  private counter = 0;

  configure(partial: Partial<EngineConfig>) {
    this.config = { ...this.config, ...partial };
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  onComplete(fn: CompleteListener) {
    this.completeListeners.add(fn);
    return () => void this.completeListeners.delete(fn);
  }

  getSnapshot = () => this.items;

  private emit() {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    const run = () => {
      this.emitScheduled = false;
      this.items = [...this.items];
      for (const l of this.listeners) l();
    };
    setTimeout(run, 80);
  }

  private patch(id: string, changes: Partial<UploadItem>) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return;
    this.items[i] = { ...this.items[i], ...changes };
    this.emit();
  }

  private item(id: string): UploadItem | undefined {
    return this.items.find((x) => x.id === id);
  }

  add(files: File[], options: UploadOptions = {}): UploadItem[] {
    const added: UploadItem[] = files.map((file) => ({
      id: `u${Date.now().toString(36)}${(++this.counter).toString(36)}`,
      file,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      status: "waiting" as const,
      uploadedBytes: 0,
      progress: 0,
      speed: 0,
      eta: null,
      error: null,
      errorCode: null,
      attempt: 0,
      serverId: null,
      uploadKey: null,
      resumed: false,
      result: null,
      shareUrl: null,
      options,
      addedAt: Date.now(),
      finishedAt: null,
    }));
    this.items = [...this.items, ...added];
    this.emit();
    this.pump();
    return added;
  }

  /** Adds a file with per-file options (used for folder uploads where each file targets a different folder). */
  addOne(file: File, options: UploadOptions): UploadItem {
    return this.add([file], options)[0];
  }

  pause(id: string) {
    const it = this.item(id);
    const rt = this.runtime.get(id);
    if (!it || !rt || !rt.running) {
      if (it?.status === "waiting") this.patch(id, { status: "paused" });
      return;
    }
    if (!["uploading", "retrying"].includes(it.status)) return;
    rt.stop = "pause";
    for (const x of rt.controllers) x.abort();
    rt.wake?.();
  }

  resume(id: string) {
    const it = this.item(id);
    if (!it || it.status !== "paused") return;
    this.patch(id, { status: "waiting", error: null });
    this.pump();
  }

  async cancel(id: string) {
    const it = this.item(id);
    if (!it) return;
    const rt = this.runtime.get(id);
    if (rt?.running) {
      rt.stop = "cancel";
      for (const x of rt.controllers) x.abort();
      rt.wake?.();
    }
    if (["complete", "failed", "cancelled"].includes(it.status)) return;
    this.patch(id, { status: "cancelled", speed: 0, eta: null, finishedAt: Date.now() });
    this.forget(it.file);
    if (it.serverId && !(it.status === "processing" || it.status === "scanning" || it.status === "finalizing" || it.status === "hashing")) {
      await this.call(it, `/${it.serverId}`, { method: "DELETE" }).catch(() => undefined);
    }
  }

  /** Talks to the right endpoint family: account uploads use the session, request uploads use their own key. */
  private call<T>(it: UploadItem, path: string, opts: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {}): Promise<T> {
    const base = it.options.request ? "/api/v1/public/uploads" : "/api/v1/uploads";
    return api<T>(`${base}${path}`, { ...opts, headers: it.uploadKey ? { "x-upload-key": it.uploadKey } : undefined });
  }

  retry(id: string) {
    const it = this.item(id);
    if (!it || !["failed", "cancelled"].includes(it.status)) return;
    this.patch(id, { status: "waiting", error: null, errorCode: null, attempt: 0, uploadedBytes: 0, progress: 0, speed: 0, eta: null, finishedAt: null, serverId: it.status === "cancelled" ? null : it.serverId });
    this.pump();
  }

  remove(id: string) {
    const it = this.item(id);
    if (!it) return;
    if (["uploading", "retrying", "waiting", "paused"].includes(it.status)) void this.cancel(id);
    this.items = this.items.filter((x) => x.id !== id);
    this.runtime.delete(id);
    this.emit();
  }

  clearFinished() {
    this.items = this.items.filter((x) => !["complete", "failed", "cancelled", "quarantined"].includes(x.status));
    this.emit();
  }

  hasActive(): boolean {
    return this.items.some((x) => ["waiting", "uploading", "retrying", "hashing", "finalizing", "processing", "paused"].includes(x.status));
  }

  // -------------------------------------------------------------------------------------------

  private pump() {
    for (const it of this.items) {
      if (this.activeSlots >= this.config.fileConcurrency) break;
      if (it.status !== "waiting") continue;
      const rt = this.runtime.get(it.id);
      if (rt?.running) continue;
      this.activeSlots++;
      void this.run(it.id).finally(() => {
        this.activeSlots--;
        this.pump();
      });
    }
  }

  private runtimeFor(id: string): Runtime {
    let rt = this.runtime.get(id);
    if (!rt) {
      rt = { controllers: new Set(), inFlight: new Map(), confirmedBytes: 0, samples: [], stop: null, running: false, wake: null };
      this.runtime.set(id, rt);
    }
    return rt;
  }

  private forget(file: File) {
    const store = readStore();
    delete store[fingerprint(file)];
    writeStore(store);
  }

  private fail(id: string, err: unknown) {
    const message = err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : "The upload failed.";
    const code = err instanceof ApiClientError ? err.code : "error";
    this.patch(id, { status: code === "quarantined" ? "quarantined" : "failed", error: message, errorCode: code, speed: 0, eta: null, finishedAt: Date.now() });
    const it = this.item(id);
    // Permanent (non-retryable) failures should not leave a resumable session behind.
    if (it && err instanceof ApiClientError && [401, 403, 409, 413, 415, 422, 507, 503].includes(err.status) && err.code !== "checksum_mismatch") this.forget(it.file);
  }

  private async run(id: string) {
    const rt = this.runtimeFor(id);
    rt.running = true;
    rt.stop = null;
    rt.controllers.clear();
    rt.inFlight.clear();
    rt.samples = [];
    try {
      let it = this.item(id);
      if (!it) return;
      this.patch(id, { status: "uploading", error: null, errorCode: null });
      const session = await this.ensureSession(id);
      it = this.item(id)!;
      if (session.status === "complete") return await this.finishFromSession(id, session);
      if (session.status === "finalizing") return await this.poll(id);
      if (session.status !== "active") throw new ApiClientError(409, "upload_closed", "This upload can no longer be continued. Start it again.");

      const done = new Set(session.received);
      rt.confirmedBytes = this.bytesFor(session, done);
      this.patch(id, { uploadedBytes: rt.confirmedBytes, progress: (rt.confirmedBytes / it.size) * 100, resumed: done.size > 0 });

      await this.sendChunks(id, session, done);

      this.patch(id, { status: "hashing", speed: 0, eta: null, uploadedBytes: it.size, progress: 100 });
      let sha: string | null = null;
      if (it.size <= this.config.clientHashLimit) sha = await sha256Hex(await it.file.arrayBuffer());
      this.patch(id, { status: "finalizing" });
      const completed = await this.call<{ upload: UploadSessionDto }>(it, `/${session.id}/complete`, { method: "POST", body: sha ? { sha256: sha } : {} });
      this.patch(id, { status: "processing" });
      await this.handleSession(id, completed.upload);
    } catch (err) {
      if (err instanceof AbortedError) {
        if (err.reason === "pause") this.patch(id, { status: "paused", speed: 0, eta: null });
        return;
      }
      if ((err as Error).name === "AbortError") return;
      this.fail(id, err);
    } finally {
      rt.running = false;
      rt.stop = null;
    }
  }

  private bytesFor(session: UploadSessionDto, done: Set<number>): number {
    let total = 0;
    for (const i of done) total += i === session.totalChunks - 1 ? session.size - i * session.chunkSize : session.chunkSize;
    return total;
  }

  private async ensureSession(id: string): Promise<UploadSessionDto> {
    let it = this.item(id)!;
    const store = readStore();
    const fp = fingerprint(it.file);

    // Try to continue a session we know about: this item's own, one saved by a previous page load for exactly this file,
    // or (when the file's timestamp differs, e.g. re-downloaded) one with the same name and size.
    const sameKind = (s: StoredUpload) => (s.requestToken ?? null) === (it.options.request?.token ?? null);
    const byNameAndSize = Object.entries(store).find(([, s]) => s.name === it.name && s.size === it.size && sameKind(s));
    const saved = store[fp] ?? byNameAndSize?.[1];
    const candidate = it.serverId ?? saved?.uploadId;
    if (candidate) {
      if (!it.serverId && saved?.uploadKey) {
        this.patch(id, { uploadKey: saved.uploadKey });
        it = this.item(id)!;
      }
      try {
        const { upload } = await this.call<{ upload: UploadSessionDto }>(it, `/${candidate}`);
        if (upload.size === it.size && ["active", "finalizing", "complete"].includes(upload.status)) {
          this.patch(id, { serverId: upload.id });
          if (byNameAndSize && !store[fp]) {
            delete store[byNameAndSize[0]];
            store[fp] = { ...byNameAndSize[1], savedAt: Date.now() };
            writeStore(store);
          }
          return upload;
        }
      } catch {
        /* session gone: start a fresh one */
      }
      delete store[fp];
      if (byNameAndSize) delete store[byNameAndSize[0]];
      writeStore(store);
      this.patch(id, { uploadKey: null });
      it = this.item(id)!;
    }

    const o = it.options;
    let upload: UploadSessionDto;
    if (o.request) {
      const res = await api<{ upload: UploadSessionDto }>(`/api/v1/public/requests/${o.request.token}/uploads`, {
        method: "POST",
        body: { fileName: it.name, size: it.size, ...(o.request.label ? { uploaderLabel: o.request.label } : {}) },
      });
      upload = res.upload;
      this.patch(id, { serverId: upload.id, uploadKey: upload.uploadKey ?? null });
    } else {
      upload = (
        await api<{ upload: UploadSessionDto }>("/api/v1/uploads", {
          method: "POST",
          body: {
            fileName: it.name,
            size: it.size,
            mime: it.mime,
            ...(o.folderId !== undefined ? { folderId: o.folderId } : {}),
            ...(o.share !== undefined ? { share: o.share } : {}),
            ...(o.expiresAt !== undefined ? { expiresAt: o.expiresAt } : {}),
            ...(o.password ? { password: o.password } : {}),
            ...(o.maxDownloads ? { maxDownloads: o.maxDownloads } : {}),
            ...(o.replaceFileId ? { replaceFileId: o.replaceFileId } : {}),
          },
        })
      ).upload;
      this.patch(id, { serverId: upload.id });
    }
    const fresh = readStore();
    fresh[fp] = { uploadId: upload.id, uploadKey: upload.uploadKey ?? null, requestToken: o.request?.token ?? null, name: it.name, size: it.size, folderId: o.folderId ?? null, savedAt: Date.now() };
    writeStore(fresh);
    return upload;
  }

  private async sendChunks(id: string, session: UploadSessionDto, done: Set<number>) {
    const rt = this.runtimeFor(id);
    const it = this.item(id)!;
    const pending: number[] = [];
    for (let i = 0; i < session.totalChunks; i++) if (!done.has(i)) pending.push(i);

    let fatal: unknown = null;
    const worker = async () => {
      while (!fatal) {
        if (rt.stop) throw new AbortedError(rt.stop);
        const index = pending.shift();
        if (index === undefined) return;
        try {
          await this.sendChunkWithRetry(id, session, index);
        } catch (err) {
          fatal = err;
          for (const x of rt.controllers) x.abort();
          throw err;
        }
      }
    };
    const workers = Array.from({ length: Math.min(this.config.chunkConcurrency, Math.max(1, pending.length)) }, () => worker());
    const results = await Promise.allSettled(workers);
    // Prefer the most meaningful error (abort intent over the follow-on failures it caused).
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
    if (rt.stop) throw new AbortedError(rt.stop);
    if (rejected.length) throw rejected.find((e) => !(e instanceof DOMException)) ?? rejected[0];
    void it;
  }

  private async sendChunkWithRetry(id: string, session: UploadSessionDto, index: number) {
    const rt = this.runtimeFor(id);
    const it = this.item(id)!;
    const start = index * session.chunkSize;
    const end = Math.min(start + session.chunkSize, session.size);
    let attempt = 0;
    for (;;) {
      if (rt.stop) throw new AbortedError(rt.stop);
      try {
        const blob = it.file.slice(start, end);
        const hash = await sha256Hex(await blob.arrayBuffer());
        await this.putChunk(id, session.id, index, blob, hash);
        rt.confirmedBytes += end - start;
        rt.inFlight.delete(index);
        this.tick(id);
        if (this.item(id)?.status === "retrying") this.patch(id, { status: "uploading", error: null });
        return;
      } catch (err) {
        rt.inFlight.delete(index);
        if (rt.stop) throw new AbortedError(rt.stop);
        attempt++;
        const retryable =
          !(err instanceof ApiClientError) || err.status === 0 || err.status >= 500 || err.status === 429 || err.code === "checksum_mismatch" || err.status === 408 || (err.status === 400 && /truncated|Content-Length/i.test(err.message));
        if (err instanceof ApiClientError && err.status === 409 && err.code === "conflict") {
          // Another request for this chunk is in flight (e.g. after a pause/resume): wait and re-check.
          await sleep(600);
          continue;
        }
        if (!retryable || attempt >= MAX_CHUNK_ATTEMPTS) throw err;
        const wait = err instanceof ApiClientError && err.retryAfter ? err.retryAfter * 1000 : Math.min(15000, 700 * 2 ** (attempt - 1)) + Math.random() * 300;
        this.patch(id, { status: "retrying", attempt, error: err instanceof ApiClientError && err.status !== 0 ? err.message : "Connection problem — retrying…" });
        await this.interruptibleSleep(rt, wait);
      }
    }
  }

  private interruptibleSleep(rt: Runtime, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        rt.wake = null;
        resolve();
      }
      rt.wake = done;
    });
  }

  private putChunk(id: string, uploadId: string, index: number, blob: Blob, hash: string | null): Promise<void> {
    const rt = this.runtimeFor(id);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      rt.controllers.add(xhr);
      const it = this.item(id);
      xhr.open("PUT", `${it?.options.request ? "/api/v1/public/uploads" : "/api/v1/uploads"}/${uploadId}/chunks/${index}`);
      xhr.setRequestHeader("content-type", "application/octet-stream");
      if (it?.uploadKey) xhr.setRequestHeader("x-upload-key", it.uploadKey);
      if (hash) xhr.setRequestHeader("x-chunk-sha256", hash);
      xhr.upload.onprogress = (e) => {
        // Real bytes handed to the network for this chunk.
        rt.inFlight.set(index, e.loaded);
        this.tick(id);
      };
      xhr.onload = async () => {
        rt.controllers.delete(xhr);
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let body: { error?: { code?: string; message?: string; details?: unknown } } | null = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        const retry = Number(xhr.getResponseHeader("retry-after") ?? "") || undefined;
        reject(new ApiClientError(xhr.status, body?.error?.code ?? "http_error", body?.error?.message ?? `Upload failed (${xhr.status}).`, body?.error?.details, retry));
      };
      xhr.onerror = () => {
        rt.controllers.delete(xhr);
        reject(new ApiClientError(0, "network_error", "Can't reach the server."));
      };
      xhr.ontimeout = xhr.onerror;
      xhr.onabort = () => {
        rt.controllers.delete(xhr);
        reject(new DOMException("Aborted", "AbortError"));
      };
      xhr.send(blob);
    });
  }

  private tick(id: string) {
    const rt = this.runtimeFor(id);
    const it = this.item(id);
    if (!it) return;
    let inflight = 0;
    for (const v of rt.inFlight.values()) inflight += v;
    const sent = Math.min(it.size, rt.confirmedBytes + inflight);
    const now = Date.now();
    rt.samples.push({ t: now, bytes: sent });
    while (rt.samples.length > 2 && now - rt.samples[0].t > SPEED_WINDOW_MS) rt.samples.shift();
    let speed = 0;
    if (rt.samples.length >= 2) {
      const a = rt.samples[0];
      const b = rt.samples[rt.samples.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0.2) speed = Math.max(0, (b.bytes - a.bytes) / dt);
    }
    const remaining = it.size - sent;
    this.patch(id, { uploadedBytes: sent, progress: (sent / it.size) * 100, speed, eta: speed > 1 ? remaining / speed : null });
  }

  // ---- server-side stages ---------------------------------------------------------------------

  private async handleSession(id: string, session: UploadSessionDto) {
    if (session.status === "failed" || session.status === "aborted" || session.status === "expired") {
      const it = this.item(id);
      if (it) this.forget(it.file);
      throw new ApiClientError(422, "upload_failed", session.error ?? "The server couldn't save this file.");
    }
    if (session.status === "complete") return this.finishFromSession(id, session);
    await this.poll(id);
  }

  private async poll(id: string) {
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      const it = this.item(id);
      if (!it || it.status === "cancelled") return;
      if (!it.serverId) return;
      const { upload } = await this.call<{ upload: UploadSessionDto }>(it, `/${it.serverId}`);
      if (upload.status === "finalizing") this.patch(id, { status: "processing" });
      else if (upload.status === "complete") return this.finishFromSession(id, upload);
      else return this.handleSession(id, upload);
      await sleep(POLL_MS);
    }
    throw new ApiClientError(504, "timeout", "The server is taking unusually long to process this file.");
  }

  private async finishFromSession(id: string, session: UploadSessionDto) {
    let current = session;
    // Contributors to a file request never see the stored file (they have no account); "complete" is the end of their story.
    if (this.item(id)?.options.request) {
      const it = this.item(id)!;
      this.forget(it.file);
      this.patch(id, { status: "complete", progress: 100, uploadedBytes: it.size, speed: 0, eta: null, finishedAt: Date.now() });
      const done = this.item(id);
      if (done) for (const l of this.completeListeners) l(done);
      return;
    }
    for (let i = 0; i < 2400; i++) {
      const file = current.file;
      if (!file) throw new ApiClientError(500, "internal_error", "The file was saved but couldn't be loaded.");
      if (file.status === "available") {
        const it = this.item(id);
        if (it) this.forget(it.file);
        this.patch(id, { status: "complete", result: file, shareUrl: file.share?.url ?? null, progress: 100, uploadedBytes: it?.size ?? file.size, speed: 0, eta: null, finishedAt: Date.now() });
        const done = this.item(id);
        if (done) for (const l of this.completeListeners) l(done);
        return;
      }
      if (file.status === "quarantined") {
        throw new ApiClientError(422, "quarantined", file.quarantineNote ?? "This file was blocked by the security scan.");
      }
      if (file.status === "failed") throw new ApiClientError(500, "internal_error", "The file couldn't be processed.");
      this.patch(id, { status: "scanning", result: file });
      await sleep(POLL_MS);
      const it = this.item(id);
      if (!it || it.status === "cancelled" || !it.serverId) return;
      current = (await this.call<{ upload: UploadSessionDto }>(it, `/${it.serverId}`)).upload;
    }
    throw new ApiClientError(504, "timeout", "The security scan is taking unusually long.");
  }
}

export { toApiError };
