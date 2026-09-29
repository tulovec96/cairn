"use client";

import { Popover } from "@ark-ui/react/popover";
import { Portal } from "@ark-ui/react/portal";
import { Tooltip } from "@ark-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface TipProps {
  label: string;
  children: ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
  disabled?: boolean;
}

/** Tooltip shown on hover and keyboard focus. The trigger must be a single focusable element. */
export function Tip({ label, children, placement = "top", disabled }: TipProps) {
  if (disabled) return children;
  return (
    <Tooltip.Root openDelay={250} closeDelay={60} positioning={{ placement, gutter: 6 }} lazyMount unmountOnExit>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content className="ui-menu z-[70] max-w-64 rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-pop">{label}</Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}

interface PopProps {
  trigger: ReactElement;
  children: ReactNode | ((api: { close: () => void }) => ReactNode);
  placement?: "bottom-end" | "bottom-start" | "top-end" | "top-start" | "right-start";
  className?: string;
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Non-modal popover for small forms and lists (notifications, upload options). */
export function Pop({ trigger, children, placement = "bottom-end", className, label, open, onOpenChange }: PopProps) {
  return (
    <Popover.Root
      positioning={{ placement, gutter: 6 }}
      lazyMount
      unmountOnExit
      open={open}
      onOpenChange={onOpenChange ? (e) => onOpenChange(e.open) : undefined}
      autoFocus
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content aria-label={label} className={cn("ui-menu z-[60] w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-line bg-surface shadow-pop outline-none", className)}>
            {typeof children === "function" ? <PopBody render={children} /> : children}
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

import { usePopoverContext } from "@ark-ui/react/popover";

function PopBody({ render }: { render: (api: { close: () => void }) => ReactNode }) {
  const api = usePopoverContext();
  return <>{render({ close: () => api.setOpen(false) })}</>;
}
