"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/Overlays";
import { useDocumentAttribute } from "@/lib/useStoredValue";

type Theme = "system" | "light" | "dark";

/** Cycles system → light → dark. The choice is stored in a cookie so the server can render it without a flash. */
export function ThemeToggle({ className, onDark }: { className?: string; onDark?: boolean }) {
  const attr = useDocumentAttribute("data-theme", "system");
  const theme: Theme = attr === "light" || attr === "dark" ? attr : "system";

  const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = `Theme: ${theme}. Switch to ${next}.`;

  return (
    <Tip label={label}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        className={onDark ? "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg " + (className ?? "") : className}
        onClick={() => {
          if (next === "system") {
            delete document.documentElement.dataset.theme;
            document.cookie = "cairn_theme=; Path=/; Max-Age=0; SameSite=Lax";
          } else {
            document.documentElement.dataset.theme = next;
            document.cookie = `cairn_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
          }
        }}
      >
        <Icon className="size-4" aria-hidden />
      </Button>
    </Tip>
  );
}
