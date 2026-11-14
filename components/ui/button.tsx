import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button primitive (components.md block 1).
 *
 * Variants: primary / secondary / ghost / danger.
 * Sizes: sm 32px, md 44px (raised from the spec's 40px to honour the 44px
 * touch-target floor), lg 48px.
 * States: default, hover, active, focus-visible (2px accent ring), disabled,
 * loading (label stays visible for screen readers).
 * All colours come from Tailwind theme roles — never raw values.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:opacity-90",
  secondary:
    "border border-border-input bg-surface text-text hover:bg-accent-tint",
  ghost: "text-text hover:bg-accent-tint",
  danger: "bg-danger text-on-primary hover:opacity-90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return [BASE, VARIANTS[variant], SIZES[size], className]
    .filter(Boolean)
    .join(" ");
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Keeps the label rendered and marks the control busy for screen readers. */
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}

/** Same visual treatment as Button, but navigates (real <a> under the hood). */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClassName(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
