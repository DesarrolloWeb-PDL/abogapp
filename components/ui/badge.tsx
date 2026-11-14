import type { ReactNode } from "react";

/**
 * Status chip (components.md block 17). Colour is always paired with a word —
 * the dot is decorative, the text carries the meaning.
 */

export type BadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-bg text-text-muted",
  success: "bg-success-tint text-success",
  warning: "bg-warning-tint text-warning",
  danger: "bg-danger-tint text-danger",
  info: "bg-info-tint text-info",
  accent: "bg-accent-tint text-accent",
};

interface BadgeProps {
  tone?: BadgeTone;
  /** Decorative leading dot (state must never be colour-only: text stays). */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = "neutral", dot = false, className, children }: BadgeProps) {
  const classes = [
    "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-medium",
    TONES[tone],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
