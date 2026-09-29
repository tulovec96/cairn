import type { Settings } from "../settings";
import { ClamAvProvider } from "./clamav";
import type { ScanProvider } from "./types";

export type { ScanProvider, ScanResult } from "./types";

/**
 * Returns the configured scanner, or null when scanning is disabled. When no scanner is configured
 * files are recorded as "not scanned" — they are never reported as clean.
 */
export function getScanProvider(settings: Settings): ScanProvider | null {
  switch (settings.scanner.provider) {
    case "clamav":
      return new ClamAvProvider({ host: settings.scanner.host, port: settings.scanner.port, timeoutMs: settings.scanner.timeoutMs });
    default:
      return null;
  }
}
