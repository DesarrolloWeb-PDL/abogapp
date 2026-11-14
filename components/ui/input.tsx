import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

/**
 * Input primitive: 44px tall (touch floor), 3:1 input border, visible
 * focus-visible accent ring, 16px text (body floor). Error/aria wiring lives
 * in FormField, which owns the label and the described-by relationships.
 */

export function fieldClasses(invalid: boolean, className?: string): string {
  return [
    "h-11 w-full rounded-md border bg-surface px-3 text-base text-text",
    "placeholder:text-text-muted",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    "disabled:cursor-not-allowed disabled:bg-bg disabled:text-text-muted",
    invalid ? "border-danger" : "border-border-input",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Input({
  className,
  invalid = false,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={fieldClasses(invalid, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

/** Same field treatment for native <select> controls. */
export function Select({
  className,
  invalid = false,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={fieldClasses(invalid, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}
