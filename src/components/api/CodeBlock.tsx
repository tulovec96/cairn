"use client";

import { CopyButton } from "@/components/ui/CopyButton";

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-line bg-surface-2">
      {label && <div className="border-b border-line px-3 py-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase">{label}</div>}
      <pre tabIndex={0} className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-fg">
        <code>{code}</code>
      </pre>
      <div className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <CopyButton value={code} iconOnly variant="ghost" label="Copy code" successMessage="Copied" />
      </div>
    </div>
  );
}
