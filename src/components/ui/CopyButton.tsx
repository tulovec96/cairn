"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";
import { useToast } from "./Toast";

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

interface CopyButtonProps {
  value: string | (() => string);
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  className?: string;
  successMessage?: string;
}

export function CopyButton({ value, label = "Copy link", variant = "secondary", size = "sm", iconOnly, className, successMessage = "Link copied" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <Button
      variant={variant}
      size={iconOnly ? (size === "sm" ? "icon-sm" : "icon") : size}
      className={className}
      aria-label={iconOnly ? label : undefined}
      icon={copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      onClick={async () => {
        const ok = await copyText(typeof value === "function" ? value() : value);
        if (ok) {
          setCopied(true);
          toast.success(successMessage);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        } else {
          toast.error("Couldn't copy automatically", "Select the text and copy it manually.");
        }
      }}
    >
      {iconOnly ? null : copied ? "Copied" : label}
    </Button>
  );
}
