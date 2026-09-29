"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabDef<T extends string> {
  value: T;
  label: string;
  badge?: ReactNode;
  hidden?: boolean;
}

interface Props<T extends string> {
  tabs: Array<TabDef<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  children: ReactNode;
}

/** Accessible tab list (roving focus with arrow keys, Home/End) with a single visible panel. */
export function Tabs<T extends string>({ tabs, value, onChange, label, className, children }: Props<T>) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const visible = tabs.filter((t) => !t.hidden);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % visible.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + visible.length) % visible.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = visible.length - 1;
    else return;
    e.preventDefault();
    onChange(visible[next].value);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  return (
    <div className={className}>
      <div ref={list} role="tablist" aria-label={label} className="flex gap-0.5 overflow-x-auto border-b border-line">
        {visible.map((t, i) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              id={`${id}-tab-${t.value}`}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls={`${id}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.value)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "relative -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
              )}
            >
              {t.label}
              {t.badge}
            </button>
          );
        })}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${value}`} className="pt-4">
        {children}
      </div>
    </div>
  );
}
