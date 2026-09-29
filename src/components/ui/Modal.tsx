"use client";

import { Dialog } from "@ark-ui/react/dialog";
import { Portal } from "@ark-ui/react/portal";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const SIZES = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-lg", xl: "sm:max-w-2xl", "2xl": "sm:max-w-4xl" } as const;

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  /** Hide the title visually (still announced to screen readers). */
  hideTitle?: boolean;
  bodyClassName?: string;
}

/** Accessible modal dialog: focus trap, Escape/backdrop dismissal, and a bottom-sheet layout on phones. */
export function Modal({ open, onOpenChange, title, description, children, footer, size = "md", hideTitle, bodyClassName }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} lazyMount unmountOnExit>
      <Portal>
        <Dialog.Backdrop className="ui-backdrop fixed inset-0 z-50" />
        <Dialog.Positioner className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <Dialog.Content
            className={cn(
              "ui-modal flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-line bg-surface shadow-pop outline-none sm:rounded-xl",
              SIZES[size],
            )}
          >
            <div className={cn("flex items-start justify-between gap-4 px-5 pt-4", hideTitle ? "pb-0" : "pb-3")}>
              <div className="min-w-0">
                <Dialog.Title className={cn("text-base font-semibold text-fg", hideTitle && "sr-only")}>{title}</Dialog.Title>
                {description && <Dialog.Description className="mt-1 text-[13px] text-muted">{description}</Dialog.Description>}
              </div>
              <Dialog.CloseTrigger
                aria-label="Close dialog"
                className="-mr-1.5 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <X className="size-4" aria-hidden />
              </Dialog.CloseTrigger>
            </div>
            <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 pb-4", bodyClassName)}>{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  side?: "left" | "right";
  children: ReactNode;
  width?: string;
  hideHeader?: boolean;
  footer?: ReactNode;
}

/**
 * Side panel built on the same dialog primitive (file details, analytics, delivery logs, and the mobile navigation drawer).
 * Right-hand panels turn into bottom sheets on phones, which is easier to reach and dismiss with a thumb.
 */
export function Drawer({ open, onOpenChange, title, side = "right", children, width = "w-full sm:w-[26rem]", hideHeader, footer }: DrawerProps) {
  const sheet = side === "right";
  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} lazyMount unmountOnExit>
      <Portal>
        <Dialog.Backdrop className="ui-backdrop fixed inset-0 z-50" />
        <Dialog.Positioner className={cn("fixed z-50 flex", sheet ? "inset-x-0 bottom-0 sm:inset-y-0 sm:right-0 sm:left-auto" : "inset-y-0 left-0")}>
          <Dialog.Content
            className={cn(
              "flex max-w-full flex-col border-line bg-surface shadow-pop outline-none",
              sheet ? "ui-drawer-right ui-sheet h-[88dvh] rounded-t-xl border-t sm:h-full sm:rounded-none sm:border-t-0 sm:border-l" : "ui-drawer-left h-full border-r",
              width,
            )}
          >
            {sheet && <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />}
            <div className={cn("flex items-center justify-between gap-3 border-b border-line px-4 py-3", hideHeader && "sr-only")}>
              <Dialog.Title className="truncate text-sm font-semibold">{title}</Dialog.Title>
              <Dialog.CloseTrigger aria-label="Close panel" className="inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg">
                <X className="size-4" aria-hidden />
              </Dialog.CloseTrigger>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            {footer && <div className="border-t border-line p-3">{footer}</div>}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
