import net from "node:net";
import type { Readable } from "node:stream";
import type { ScanProvider, ScanResult } from "./types";

export interface ClamdOptions {
  host: string;
  port: number;
  timeoutMs: number;
}

const CHUNK = 64 * 1024;

/**
 * Minimal clamd client speaking the documented INSTREAM protocol:
 *   zINSTREAM\0, then repeated <4-byte big-endian length><data>, terminated by a zero-length chunk.
 * The daemon answers "stream: OK", "stream: <Signature> FOUND" or "... ERROR".
 */
export class ClamAvProvider implements ScanProvider {
  readonly name = "clamav";
  constructor(private readonly opts: ClamdOptions) {}

  async ping(): Promise<boolean> {
    const reply = await this.talk((socket) => void socket.write("zPING\0"));
    return reply.trim().replace(/\0/g, "") === "PONG";
  }

  async scan(stream: Readable): Promise<ScanResult> {
    let reply: string;
    try {
      reply = await this.talk(async (socket) => {
        socket.write("zINSTREAM\0");
        for await (const raw of stream) {
          const data = raw as Buffer;
          for (let off = 0; off < data.length; off += CHUNK) {
            const part = data.subarray(off, Math.min(off + CHUNK, data.length));
            const header = Buffer.alloc(4);
            header.writeUInt32BE(part.length, 0);
            if (!socket.write(Buffer.concat([header, part]))) {
              await new Promise<void>((resolve, reject) => {
                socket.once("drain", resolve);
                socket.once("error", reject);
                socket.once("close", () => reject(new Error("clamd closed the connection")));
              });
            }
          }
        }
        socket.write(Buffer.alloc(4));
      });
    } catch (err) {
      return { status: "error", details: (err as Error).message };
    }
    const text = reply.replace(/\0/g, "").trim();
    if (/OK$/.test(text)) return { status: "clean", details: text };
    const found = /^stream:\s*(.+?)\s+FOUND$/.exec(text);
    if (found) return { status: "infected", signature: found[1], details: text };
    return { status: "error", details: text || "Empty response from clamd" };
  }

  private talk(send: (socket: net.Socket) => void | Promise<void>): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.opts.host, port: this.opts.port });
      const chunks: Buffer[] = [];
      let settled = false;
      const done = (err: Error | null, value?: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (err) reject(err);
        else resolve(value ?? "");
      };
      socket.setTimeout(this.opts.timeoutMs, () => done(new Error("Timed out talking to clamd")));
      socket.on("error", (e) => done(e));
      socket.on("data", (d) => chunks.push(d));
      socket.on("end", () => done(null, Buffer.concat(chunks).toString("utf8")));
      socket.on("close", () => done(null, Buffer.concat(chunks).toString("utf8")));
      socket.on("connect", () => {
        Promise.resolve(send(socket)).catch((e) => done(e as Error));
      });
    });
  }
}
