"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const CONTROL =
  "w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-subtle " +
  "transition-colors hover:border-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 " +
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(CONTROL, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(CONTROL, "min-h-20 py-2", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(CONTROL, "h-9 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; "aria-describedby": string | undefined; "aria-invalid": boolean | undefined }) => ReactNode;
  className?: string;
  optional?: boolean;
}

/** Label + control + hint/error, wired for screen readers. Children receive the ids to spread on the control. */
export function Field({ label, hint, error, children, className, optional }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline justify-between text-[13px] font-medium text-fg">
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-subtle">Optional</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, className, ...rest }, ref) {
  const input = (
    <input
      ref={ref}
      type="checkbox"
      className={cn("size-4 shrink-0 cursor-pointer rounded border-line-strong accent-[var(--accent)]", className)}
      {...rest}
    />
  );
  if (!label) return input;
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
      {input}
      <span>{label}</span>
    </label>
  );
});
