import { cn } from "@/lib/cn";

/** Three balanced stones: a cairn. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="Cairn" className={cn("size-7", className)}>
      <rect x="4" y="21" width="24" height="7" rx="3.5" fill="currentColor" opacity="0.95" />
      <rect x="8" y="12.5" width="16" height="6.5" rx="3.25" fill="currentColor" opacity="0.75" />
      <rect x="12" y="5" width="8" height="6" rx="3" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark className={cn("text-accent", markClassName)} />
      <span>Cairn</span>
    </span>
  );
}
