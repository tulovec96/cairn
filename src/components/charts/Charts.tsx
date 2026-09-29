import { cn } from "@/lib/cn";

/** Small dependency-free SVG charts. They draw exactly the numbers they're given and label them in text too. */

export function AreaChart({ points, format, label, className }: { points: Array<{ label: string; value: number }>; format: (v: number) => string; label: string; className?: string }) {
  const W = 600;
  const H = 140;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const y = (v: number) => H - 6 - (v / max) * (H - 18);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${((points.length - 1) * step).toFixed(1)},${H} L0,${H} Z`;
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <figure className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: from ${first ? format(first.value) : "0"} to ${last ? format(last.value) : "0"}`} className="h-36 w-full" preserveAspectRatio="none">
        <path d={area} className="fill-accent/15" />
        <path d={line} className="fill-none stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-subtle tnum">
        <span>{first?.label}</span>
        <span>peak {format(max)}</span>
        <span>{last?.label}</span>
      </figcaption>
    </figure>
  );
}

export function BarChart({ points, format, label, series = "value", className }: { points: Array<{ label: string; value: number; alt?: number }>; format: (v: number) => string; label: string; series?: string; className?: string }) {
  const max = Math.max(1, ...points.map((p) => p.value), ...points.map((p) => p.alt ?? 0));
  const total = points.reduce((n, p) => n + p.value, 0);
  return (
    <figure className={className}>
      <div role="img" aria-label={`${label}: ${format(total)} in total ${series}`} className="flex h-36 items-end gap-[2px]">
        {points.map((p) => (
          <div key={p.label} className="group relative flex h-full flex-1 items-end gap-px" title={`${p.label}: ${format(p.value)}${p.alt !== undefined ? ` / ${format(p.alt)}` : ""}`}>
            <div className="w-full rounded-t-sm bg-accent/80 group-hover:bg-accent" style={{ height: `${Math.max(p.value > 0 ? 2 : 0, (p.value / max) * 100)}%` }} />
            {p.alt !== undefined && <div className="w-full rounded-t-sm bg-warning/70 group-hover:bg-warning" style={{ height: `${Math.max(p.alt > 0 ? 2 : 0, (p.alt / max) * 100)}%` }} />}
          </div>
        ))}
      </div>
      <figcaption className="mt-1 flex justify-between text-xs text-subtle tnum">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}

export function Meter({ value, max, tone = "accent", label, className }: { value: number; max: number; tone?: "accent" | "warning" | "danger"; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-accent";
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className={cn("h-2 overflow-hidden rounded-full bg-surface-3", className)}>
      <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
