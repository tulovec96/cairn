import Link from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon-sm" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent",
  secondary: "bg-surface text-fg border border-line-strong hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg border border-transparent",
  danger: "bg-danger text-white hover:brightness-110 border border-transparent",
  "danger-outline": "bg-surface text-danger border border-line-strong hover:bg-danger-soft",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
  "icon-sm": "h-8 w-8 justify-center",
  icon: "h-9 w-9 justify-center",
};

export function buttonClass(opts?: { variant?: ButtonVariant; size?: ButtonSize; full?: boolean; className?: string }) {
  return cn(
    "inline-flex shrink-0 items-center rounded-md font-medium whitespace-nowrap transition-colors select-none",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    VARIANTS[opts?.variant ?? "secondary"],
    SIZES[opts?.size ?? "md"],
    opts?.full && "w-full justify-center",
    opts?.className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, full, loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass({ variant, size, full, className })} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  icon?: ReactNode;
  prefetch?: boolean;
}

export function ButtonLink({ href, variant, size, full, icon, className, children, prefetch, ...rest }: ButtonLinkProps) {
  return (
    <Link href={href} prefetch={prefetch} className={buttonClass({ variant, size, full, className })} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
