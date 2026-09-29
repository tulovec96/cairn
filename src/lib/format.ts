const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : value >= 100 ? 0 : decimals)} ${UNITS[i]}`;
}

export function formatMoney(cents: number, currency = "usd"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "—";
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const LOCALE = "en-US";
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The signed-in user's time zone, published by the root layout for client-side rendering. Server renders pass it explicitly. */
function browserZone(): string | undefined {
  return typeof document !== "undefined" ? document.documentElement.dataset.tz || undefined : undefined;
}

function dateFormatter(kind: "date" | "dateTime", tz?: string): Intl.DateTimeFormat {
  const zone = tz || browserZone();
  const key = `${kind}|${zone ?? ""}`;
  let f = formatters.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = kind === "date" ? { year: "numeric", month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    try {
      f = new Intl.DateTimeFormat(LOCALE, zone ? { ...opts, timeZone: zone } : opts);
    } catch {
      f = new Intl.DateTimeFormat(LOCALE, opts); // an unknown zone name must never break a page
    }
    formatters.set(key, f);
  }
  return f;
}

export function formatDate(value: string | Date | null | undefined, tz?: string): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "—" : dateFormatter("date", tz).format(d);
}

export function formatDateTime(value: string | Date | null | undefined, tz?: string): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "—" : dateFormatter("dateTime", tz).format(d);
}
export function timeAgo(value: string | Date | null | undefined, now = Date.now()): string {
  if (!value) return "—";
  const t = (typeof value === "string" ? new Date(value) : value).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.round((now - t) / 1000);
  if (diff < 45) return "just now";
  if (diff < 90) return "1 min ago";
  const min = Math.round(diff / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return formatDate(new Date(t));
}

/** "3 days left", "expired", "never" */
export function timeUntil(value: string | Date | null | undefined, now = Date.now()): string {
  if (!value) return "Never expires";
  const t = (typeof value === "string" ? new Date(value) : value).getTime();
  const diff = Math.round((t - now) / 1000);
  if (diff <= 0) return "Expired";
  if (diff < 90) return "Less than a minute left";
  const min = Math.round(diff / 60);
  if (min < 60) return `${min} min left`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h left`;
  const d = Math.round(h / 24);
  return `${d} days left`;
}

export function isExpired(value: string | Date | null | undefined, now = Date.now()): boolean {
  if (!value) return false;
  return new Date(value).getTime() <= now;
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString(LOCALE)} ${n === 1 ? singular : plural}`;
}

export function percent(used: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}
