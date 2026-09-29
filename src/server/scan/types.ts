import type { Readable } from "node:stream";

export type ScanOutcome = "clean" | "infected" | "error";

export interface ScanResult {
  status: ScanOutcome;
  signature?: string;
  details?: string;
}

/** A malware scanner backend. Implementations must never report "clean" unless a scan actually completed. */
export interface ScanProvider {
  readonly name: string;
  scan(stream: Readable, size: number): Promise<ScanResult>;
  ping?(): Promise<boolean>;
}
