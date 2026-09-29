"use client";

import { Menu } from "@ark-ui/react/menu";
import { Portal } from "@ark-ui/react/portal";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type MenuEntry =
  | { type?: "item"; value: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; hint?: string; onSelect: () => void }
  | { type: "separator"; value?: string }
  | { type: "label"; label: string; value?: string };

function Entries({ items }: { items: MenuEntry[] }) {
  return (
    <>
      {items.map((entry, i) => {
        if (entry.type === "separator") return <Menu.Separator key={`sep-${i}`} className="my-1 h-px bg-line" />;
        if (entry.type === "label") {
          return (
            <div key={`label-${i}`} className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">
              {entry.label}
            </div>
          );
        }
        return (
          <Menu.Item
            key={entry.value}
            value={entry.value}
            disabled={entry.disabled}
            onSelect={entry.onSelect}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] outline-none select-none",
              "data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45",
              entry.danger ? "text-danger data-[highlighted]:bg-danger-soft" : "text-fg",
            )}
          >
            {entry.icon && <span className="flex size-4 shrink-0 items-center justify-center text-subtle [&>svg]:size-4">{entry.icon}</span>}
            <span className="flex-1 truncate">{entry.label}</span>
            {entry.hint && <span className="text-[11px] text-subtle">{entry.hint}</span>}
          </Menu.Item>
        );
      })}
    </>
  );
}

/**
 * Menus close on pointer-up, so the browser's follow-up "click" lands on whatever was under the menu item.
 * Rows use this to ignore that stray click.
 */
let lastMenuClosedAt = 0;
export const menuJustClosed = () => Date.now() - lastMenuClosedAt < 350;
const trackClose = (e: { open: boolean }) => {
  if (!e.open) lastMenuClosedAt = Date.now();
};

const CONTENT = "ui-menu z-[60] min-w-48 max-w-72 rounded-lg border border-line bg-surface p-1 shadow-pop outline-none";

interface DropdownMenuProps {
  trigger: ReactNode;
  items: MenuEntry[];
  placement?: "bottom-end" | "bottom-start" | "top-end" | "top-start" | "right-start";
}

/** Button-triggered menu with full keyboard support (arrow keys, type-ahead, Escape). */
export function DropdownMenu({ trigger, items, placement = "bottom-end" }: DropdownMenuProps) {
  return (
    <Menu.Root positioning={{ placement, gutter: 4 }} lazyMount unmountOnExit onOpenChange={trackClose}>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content className={CONTENT}>
            <Entries items={items} />
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

interface ContextMenuProps {
  items: MenuEntry[] | (() => MenuEntry[]);
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

/** Right-click (or long-press) menu wrapper. Renders a div around its children. */
export function ContextMenu({ items, children, className, disabled }: ContextMenuProps) {
  const list = typeof items === "function" ? items() : items;
  if (disabled) return <div className={className}>{children}</div>;
  return (
    <Menu.Root positioning={{ placement: "right-start", gutter: 2 }} lazyMount unmountOnExit onOpenChange={trackClose}>
      <Menu.ContextTrigger asChild>
        <div className={className}>{children}</div>
      </Menu.ContextTrigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content className={CONTENT}>
            <Entries items={list} />
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
