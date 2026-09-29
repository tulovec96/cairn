import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 className={cn("size-4 animate-spin text-subtle", className)} aria-hidden />
      <span className="sr-only">{label ?? "Loading"}</span>
    </span>
  );
}

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const BADGE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-accent-soft text-accent border-accent-line",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] leading-5 font-medium whitespace-nowrap", BADGE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

interface ProgressProps {
  value: number | null;
  tone?: "accent" | "success" | "warning" | "danger";
  className?: string;
  label: string;
}

const BAR: Record<NonNullable<ProgressProps["tone"]>, string> = { accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger" };

/** `value=null` renders an indeterminate bar (used while the server verifies/scans). */
export function ProgressBar({ value, tone = "accent", className, label }: ProgressProps) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value)}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      {value === null ? (
        <div className={cn("absolute inset-y-0 w-2/5 rounded-full", BAR[tone])} style={{ animation: "ui-indeterminate 1.3s ease-in-out infinite" }} />
      ) : (
        <div className={cn("h-full rounded-full transition-[width] duration-200", BAR[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-3", className)} />;
}

interface EmptyProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-line bg-surface-2 text-subtle [&>svg]:size-5">{icon}</div>
      <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ children, className, tone = "danger" }: { children: ReactNode; className?: string; tone?: "danger" | "warning" | "info" }) {
  const tones = {
    danger: "border-danger/30 bg-danger-soft text-danger",
    warning: "border-warning/30 bg-warning-soft text-warning",
    info: "border-accent-line bg-accent-soft text-fg",
  } as const;
  return (
    <div role={tone === "info" ? "status" : "alert"} className={cn("rounded-md border px-3 py-2 text-[13px]", tones[tone], className)}>
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-px font-mono text-[11px] text-muted">{children}</kbd>;
}

export function Avatar({ name, className, src }: { name: string; className?: string; src?: string | null }) {
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img aria-hidden alt="" src={src} className={cn("inline-block size-8 shrink-0 rounded-full object-cover", className)} />;
  }
  return (
    <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent", className)}>
      {initials || "?"}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-5">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-line bg-surface", className)}>{children}</div>;
}

export function CardHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
